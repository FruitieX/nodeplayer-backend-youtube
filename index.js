'use strict';

const Backend = require('nodeplayer').Backend;
const defaultConfig = require('./default-config');

const ytdl = require('ytdl-core');
const https = require('https');
const querystring = require('querystring');

module.exports = class YouTube extends Backend {
  constructor(callback) {
    super(defaultConfig);

    callback(null, this);
  }

  /* Search for music from the backend
   * On success: callback must be called with a list of song objects
   * On failure: errCallback must be called with error message
   */
  search(query, callback) {
    var jsonData = '';
    var url = 'https://www.googleapis.com/youtube/v3/search?';

    // TODO: pagination?, youtube doesnt like returning over 30 results
    url += querystring.stringify({
      'q': query.any,
      'pageToken': query.pageToken,
      'type': 'video',
      'part': 'snippet',
      'maxResults': Math.min(30, this.coreConfig.searchResultCnt),
      'regionCode': this.config.regionCode,
      'key': this.config.apiKey
    });

    var req = https.request(url, (res) => {
      res.on('data', (chunk) => {
        jsonData += chunk.toString('utf8');
        //fs.writeSync(songFd, chunk, 0, chunk.length, null);
      });
      res.on('end', () => {
        jsonData = JSON.parse(jsonData);
        var results = {};
        results.songs = [];

        var ids = [];
        if (jsonData.items) {
          results.nextPageToken = jsonData.nextPageToken;
          results.prevPageToken = jsonData.prevPageToken;

          for (var i = 0; i < jsonData.items.length; i++) {
            ids.push(jsonData.items[i].id.videoId);
          }

          this.getSongDurations(ids, (err, durations) => {
            if (err) {
              return callback(`error while getting song durations from youtube: ${err}`);
            }

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
              results.songs.push({
                artist: artist,
                title: title,
                album: jsonData.items[i].snippet.channelTitle,
                albumArt: {
                  hq: jsonData.items[i].snippet.thumbnails.high.url,
                  lq: jsonData.items[i].snippet.thumbnails.default.url
                },
                duration: durations[jsonData.items[i].id.videoId],
                songID: jsonData.items[i].id.videoId,
                // TODO: no relevancy in score?
                score: this.config.maxScore * (numItems - i) / numItems,
                backendName: this.name,
                format: 'opus'
              });
            }

            callback(null, results);
          }, (err) => {
            callback('error while searching youtube: ' + err);
          });
        } else {
          callback('youtube: no results found');
        }
      });
    });
    req.end();
  }

  getSongDurations(ids, callback) {
    var url = 'https://www.googleapis.com/youtube/v3/videos?' +
      'id=' + ids.join(',') +
      '&' +
      querystring.stringify({
        'part': 'contentDetails',
        'key': this.config.apiKey
      });

      var jsonData = '';

      var req = https.request(url, (res) => {
        res.on('data', (chunk) => {
          jsonData += chunk.toString('utf8');
          //fs.writeSync(songFd, chunk, 0, chunk.length, null);
        });
        res.on('end', () => {
          var durations = {};

          jsonData = JSON.parse(jsonData);
          if (jsonData) {
            for (var i = 0; i < jsonData.items.length; i++) {
              durations[jsonData.items[i].id] =
                this.ytDurationToMillis(jsonData.items[i].contentDetails.duration);
            }
            callback(null, durations);
          } else {
            callback('youtube: unexpected error while fetching metadata');
          }
        });
      });
      req.end();
  }

  // WTF youtube
  // http://stackoverflow.com/questions/22148885/
  // converting-youtube-data-api-v3-video-duration-format-to-seconds-in-javascript-no
  ytDurationToMillis(ytDuration) {
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
  }
}
