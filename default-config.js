var defaultConfig = {};

// It's advicable to generate your own key and use it instead.
// The default may stop working at any time, see README.md
defaultConfig.apiKey = 'AIzaSyB3CsRUP-IEz87_pqIct1c1HInmec9s7fY';

// Change this to your own region code to get correct search results
// for your region. See README.md
defaultConfig.regionCode = 'FI';

// Youtube provides very accurate search results, but sometimes they
// are not of high quality. Other backends may take precedence.
defaultConfig.maxScore = 50;

module.exports = defaultConfig;
