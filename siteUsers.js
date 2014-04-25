var async = require('async');
var request = require('request');

var INSTAGRAM_TOKEN = process.env.INSTAGRAM_TOKEN;
var MEETUP_TOKEN = process.env.MEETUP_TOKEN;
var KLOUT_TOKEN = process.env.KLOUT_TOKEN;

function kloutCompare(number, callback) {
  request.get('http://api.klout.com/v2/identity.json/klout/' + number +
    '/tw?key=' + KLOUT_TOKEN, function (err, res) {
    setTimeout(function () {
      if (res.statusCode === 404) {
        return callback(-1);
      }

      if (res.statusCode === 200) {
        return callback(1);
      }

      callback(0);
    }, 1000);
  });
}

function meetupCompare(number, callback) {
  request.get('https://api.meetup.com/2/member/' + number + '?key=' +
    MEETUP_TOKEN + '&sign=true&page=20',
    function (err, res, body) {
    if (res.statusCode === 404 ||
      (body.problem &&
      body.problem === "Not Found")) {
      return callback(-1);
    }

    if (res.statusCode === 200) {
      return callback(1);
    }

    return callback(0);
  });
}

/*
function runkeeperCompare(number, callback) {
  request.get({
    url: 'http://runkeeper.com/relationship?confirm=&target=' + number,
    followRedirect: true,
    maxRedirects: 2
  }, function (err, res) {
    console.log(number, res.statusCode);

    if (res.statusCode === 200) {
      return callback(-1);
    }

    if (res.statusCode === 302) {
      return callback(1);
    }

    return callback(0);
  });
}
*/

function stocktwitsCompare(number, callback) {
  request.get('https://api.stocktwits.com/api/2/streams/user/' + number +
    '.json', function (err, res) {
    if (res.statusCode === 404) {
      return callback(-1);
    }

    if (res.statusCode === 200) {
      return callback(1);
    }

    return callback(0);
  });
}

function instagramCompare(number, callback) {
  request.get('https://api.instagram.com/v1/users/' + number +
    '/?access_token=' + INSTAGRAM_TOKEN, function (err, res) {
    if (res.statusCode === 400) {
      return callback(-1);
    }

    if (res.statusCode === 200) {
      return callback(1);
    }

    return callback(0);
  });
}

function foursquareCompare(number, callback) {
  request.get('https://foursquare.com/user/' + number,
    function (err, res) {
    if (res.statusCode === 404) {
      return callback(-1);
    }

    if (res.statusCode === 301 ||
      res.statusCode === 200) {
      return callback(1);
    }

    return callback(0);
  });
}

function twitterCompare(number, callback) {
  request.get('https://twitter.com/account/redirect_by_id?id=' + number,
    function (err, res) {
    if (res.statusCode === 404) {
      return callback(-1);
    }

    if (res.statusCode === 302 ||
      res.statusCode === 301 ||
      res.statusCode === 200) {
      return callback(1);
    }

    return callback(0);
  });
}

function gitHubUsers(callback) {
  request.get({
    json: true,
    url: 'https://github.com/users.json'
  }, function (err, res, body) {
    callback(body.total);
  });
}

function binaryUserSearch(low, high, comparisonFn, callback) {
  var EPSILON = 100;

  var i;

  async.whilst(function () {
    return Math.abs(high - low) >= EPSILON;
  }, function (cb) {
    i = Math.floor((low + high) / 2);

    comparisonFn(i, function (result) {
      if (result === 1) {
        low = i + 1;
        return cb();
      }

      if (result === -1) {
        high = i - 1;
        return cb();
      }

      throw new Error();
    });
  }, function () {
    callback(i);
  });
}

async.parallel({
  twitter: function (cb) {
    binaryUserSearch(1000000, 2000000000, twitterCompare, function (result) {
      cb(null, result);
    });
  },
  foursquare: function (cb) {
    binaryUserSearch(1000000, 1000000000, foursquareCompare, function (result) {
      cb(null, result);
    });
  },
  instagram: function (cb) {
    binaryUserSearch(188131983, 1000000000, instagramCompare, function (result) {
      cb(null, result);
    });
  },
  /*
  runkeeper: function (cb) {
    binaryUserSearch(100000, 100000000000, runkeeperCompare, function (result) {
      cb(null, result);
    });
  },
  */
  meetup: function (cb) {
    binaryUserSearch(1000000, 1000000000, meetupCompare, function (result) {
      cb(null, result);
    });
  },
  klout: function (cb) {
    binaryUserSearch(100000, 1000000000, kloutCompare, function (result) {
      cb(null, result);
    });
  },
  stocktwits: function (cb) {
    binaryUserSearch(100000, 1000000000, stocktwitsCompare, function (result) {
      cb(null, result);
    });
  },
  github: function (cb) {
    gitHubUsers(function (result) {
      cb(null, result);
    });
  }
},
function (err, result) {
  console.log(JSON.stringify(result));
});
