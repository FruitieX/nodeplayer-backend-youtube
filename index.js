'use strict';

var MODULE_NAME = 'youtube';
var MODULE_TYPE = 'backend';

var mkdirp = require('mkdirp');
var https = require('https');
var querystring = require('querystring');
var fs = require('fs');
var ytdl = require('ytdl-core');
var ffmpeg = require('fluent-ffmpeg');

var nodeplayerConfig = require('nodeplayer').config;
var coreConfig = nodeplayerConfig.getConfig();
var defaultConfig = require('./default-config.js');
var config = nodeplayerConfig.getConfig(MODULE_TYPE + '-' + MODULE_NAME, defaultConfig);

var youtubeBackend = {};
youtubeBackend.name = MODULE_NAME;
var musicCategoryId = '';

var player;
var logger;

// TODO: seeking
var encodeSong = function(origStream, seek, song, progCallback, errCallback) {
    var incompletePath = coreConfig.songCachePath + '/youtube/incomplete/' + song.songID + '.opus';
    var incompleteStream = fs.createWriteStream(incompletePath, {flags: 'w'});
    var encodedPath = coreConfig.songCachePath + '/youtube/' + song.songID + '.opus';

    var command = ffmpeg(origStream)
        .noVideo()
        //.inputFormat('mp3')
        //.inputOption('-ac 2')
        .audioCodec('libopus')
        .audioBitrate('192')
        .format('opus')
        .on('error', function(err) {
            logger.error('error while transcoding ' + song.songID + ': ' + err);
            if (fs.existsSync(incompletePath)) {
                fs.unlinkSync(incompletePath);
            }
            errCallback(song, err);
        });

    var opusStream = command.pipe(null, {end: true});
    opusStream.on('data', function(chunk) {
        incompleteStream.write(chunk, undefined, function() {
            progCallback(song, chunk.length, false);
        });
    });
    opusStream.on('end', function() {
        incompleteStream.end(undefined, undefined, function() {
            logger.verbose('transcoding ended for ' + song.songID);

            // TODO: we don't know if transcoding ended successfully or not,
            // and there might be a race condition between errCallback deleting
            // the file and us trying to move it to the songCache

            // atomically move result to encodedPath
            if (fs.existsSync(incompletePath)) {
                fs.renameSync(incompletePath, encodedPath);
                progCallback(song, 0, true);
            } else {
                progCallback(song, 0, false);
            }
        });
    });

    logger.verbose('transcoding ' + song.songID + '...');
    return function(err) {
        command.kill();
        logger.verbose('canceled preparing: ' + song.songID + ': ' + err);
        if (fs.existsSync(incompletePath)) {
            fs.unlinkSync(incompletePath);
        }
        errCallback(song, 'canceled preparing: ' + song.songID + ': ' + err);
    };
};

var youtubeDownload = function(song, progCallback, errCallback) {
    var ytStream = ytdl('http://www.youtube.com/watch?v=' + song.songID);
    var cancelEncoding = encodeSong(ytStream, 0, song, progCallback, errCallback);
    return function(err) {
        cancelEncoding(err);
    };
};

// cache songID to disk.
// on success: progCallback must be called with true as argument
// on failure: errCallback must be called with error message
// returns a function that cancels preparing
youtubeBackend.prepareSong = function(song, progCallback, errCallback) {
    var filePath = coreConfig.songCachePath + '/youtube/' + song.songID + '.opus';

    if (fs.existsSync(filePath)) {
        // true as first argument because there is song data
        progCallback(song, true, true);
    } else {
        return youtubeDownload(song, progCallback, errCallback);
    }
};

youtubeBackend.isPrepared = function(song) {
    var filePath = coreConfig.songCachePath + '/youtube/' + song.songID + '.opus';
    return fs.existsSync(filePath);
};

// WTF youtube
// http://stackoverflow.com/questions/22148885/
// converting-youtube-data-api-v3-video-duration-format-to-seconds-in-javascript-no
var ytDurationToMillis = function(ytDuration) {
    var matches = ytDuration.match(/[0-9]+[HMS]/g);
    var seconds = 0;

    matches.forEach(function(part) {
        var unit = part.charAt(part.length - 1);
        var amount = parseInt(part.slice(0, -1));

        switch (unit) {
            case 'H':
                seconds += amount * 60 * 60;
                break;
            case 'M':
                seconds += amount * 60;
                break;
            case 'S':
                seconds += amount;
                break;
        }
    });

    return seconds * 1000;
};

var getSongDurations = function(ids, callback, errCallback) {
    var url = 'https://www.googleapis.com/youtube/v3/videos?' +
            'id=' + ids.join(',') +
            '&' +
            querystring.stringify({
                'part': 'contentDetails',
                'key': config.apiKey
            });

    var jsonData = '';

    var req = https.request(url, function(res) {
        res.on('data', function(chunk) {
            jsonData += chunk.toString('utf8');
            //fs.writeSync(songFd, chunk, 0, chunk.length, null);
        });
        res.on('end', function() {
            var durations = {};

            jsonData = JSON.parse(jsonData);
            if (jsonData) {
                for (var i = 0; i < jsonData.items.length; i++) {
                    durations[jsonData.items[i].id] =
                        ytDurationToMillis(jsonData.items[i].contentDetails.duration);
                }
                callback(durations);
            } else {
                errCallback('youtube: unexpected error while fetching metadata');
            }
        });
    });
    req.end();
};

// search for music from the backend
// on success: callback must be called with a list of song objects
// on failure: errCallback must be called with error message
youtubeBackend.search = function(query, callback, errCallback) {
    var jsonData = '';
    var url = 'https://www.googleapis.com/youtube/v3/search?' +
            // TODO: pagination?, youtube doesnt like returning over 30 results
            querystring.stringify({
                'q': query.terms,
                'pageToken': query.pageToken,
                'type': 'video',
                'part': 'snippet',
                'maxResults': Math.min(30, coreConfig.searchResultCnt),
                'regionCode': config.regionCode,
                'key': config.apiKey
            });
    var req = https.request(url, function(res) {
        res.on('data', function(chunk) {
            jsonData += chunk.toString('utf8');
            //fs.writeSync(songFd, chunk, 0, chunk.length, null);
        });
        res.on('end', function() {
            jsonData = JSON.parse(jsonData);
            var results = {};
            results.songs = {};

            var ids = [];
            if (jsonData.items) {
                results.nextPageToken = jsonData.nextPageToken;
                results.prevPageToken = jsonData.prevPageToken;

                for (var i = 0; i < jsonData.items.length; i++) {
                    ids.push(jsonData.items[i].id.videoId);
                }

                getSongDurations(ids, function(durations) {
                    for (var i = 0; i < jsonData.items.length; i++) {
                        var artist;
                        var title;
                        var splitTitle = jsonData.items[i].snippet.title.split(/\s-\s(.+)?/);
                        // title could not be parsed out
                        if (!splitTitle[1]) {
                            artist = null;
                            title = splitTitle[0];
                        } else {
                            artist = splitTitle[0];
                            title = splitTitle[1];
                        }

                        var numItems = jsonData.items.length;
                        results.songs[jsonData.items[i].id.videoId] = {
                            artist: artist,
                            title: title,
                            album: jsonData.items[i].snippet.channelTitle,
                            albumArt: {
                                hq: jsonData.items[i].snippet.thumbnails.high.url,
                                lq: jsonData.items[i].snippet.thumbnails.default.url
                            },
                            duration: durations[jsonData.items[i].id.videoId],
                            songID: jsonData.items[i].id.videoId,
                            score: 100 * (numItems - i) / numItems, // TODO: is there a better way?
                            backendName: MODULE_NAME,
                            format: 'opus'
                        };
                    }

                    callback(results);
                }, function(err) {
                    errCallback('error while searching youtube: ' + err);
                });
            } else {
                errCallback('youtube: no results found');
            }
        });
    });
    req.end();
};

// called when partyplay is started to initialize the backend
// do any necessary initialization here
youtubeBackend.init = function(_player, _logger, callback) {
    player = _player;
    logger = _logger;

    mkdirp.sync(coreConfig.songCachePath + '/youtube/incomplete');

    // find the category id for music videos
    var jsonData = '';
    var url = 'https://www.googleapis.com/youtube/v3/videoCategories?' +
            querystring.stringify({
                'part': 'snippet',
                'regionCode': config.regionCode,
                'key': config.apiKey
            });
    var req = https.request(url, function(res) {
        res.on('data', function(chunk) {
            jsonData += chunk.toString('utf8');
            //fs.writeSync(songFd, chunk, 0, chunk.length, null);
        });
        res.on('end', function() {
            jsonData = JSON.parse(jsonData);
            if (!jsonData.items) {
                callback('failed to get music category id, is the api key correct?');
                return;
            }
            for (var i = 0; i < jsonData.items.length; i++) {
                if (jsonData.items[i].snippet.title === 'Music') {
                    musicCategoryId = jsonData.items[i].id;
                    callback();
                    break;
                }
            }
            if (musicCategoryId === '') {
                callback('category for music not supported in your country!');
            }
        });
    });
    req.end();
};

module.exports = youtubeBackend;
