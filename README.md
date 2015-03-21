nodeplayer-backend-youtube
==========================

[![Build Status](https://travis-ci.org/FruitieX/nodeplayer-backend-youtube.svg?branch=master)](https://travis-ci.org/FruitieX/nodeplayer-backend-youtube)

Youtube backend for nodeplayer

Setup
-----

* Enable backend `youtube` in: `~/.nodeplayer/config/core.json`
* Run nodeplayer once to generate sample config file: `npm start`
* Edit `~/.nodeplayer/config/youtube.json`. You must provide a valid API key and
  your country code.
* API key can be generated in the Google Developer Console by creating a new
  project and enabling YouTube Data API v3 for it. The API key is then found in
  APIs & auth -> Credentials -> Create new Key -> Server key -> API KEY
