var async = require('async');
var express = require('express');
var OAuth2 = require('oauth').OAuth2;
var querystring = require('querystring');
var request = require('request');
var sprintf = require('sprintf').sprintf;
var _ = require('underscore');

var MongoStore = require('connect-mongo')(express);

var mongo = require('mongodb');

var server = new mongo.Server('localhost', 27017, { auto_reconnect: true });
var db = new mongo.Db('idego', server, { safe: true });

var PROFILES;
var COUNTERS;

var usedServices = [
  'foursquare',
  'GitHub',
  'Instagram',
  'Klout',
  'Meetup',
  'StockTwits',
  'Twitter'
];

function initDb(cb) {
  db.open(function (err, idegoDb) {
    if (err) {
      console.error("Error: " + err);
    }

    idegoDb.createCollection('profiles', function (err, profilesCollection) {
      PROFILES = profilesCollection;

      idegoDb.createCollection('counters', function (err, countersCollection) {
        COUNTERS = countersCollection;

        cb();
      });
    });
  });
}

var oa = new OAuth2(process.env.SINGLY_CLIENT_ID,
  process.env.SINGLY_CLIENT_SECRET, process.env.API_URL);

// A convenience method that takes care of adding the access token to requests
function getProtectedResource(path, session, callback) {
  oa.getProtectedResource(process.env.API_URL + path, session.access_token,
    function (err, data) {
    if (err) {
      return callback(err);
    }

    try {
      data = JSON.parse(data);
    } catch (parseErr) {
      err = parseErr;
    }

    callback(err, data);
  });
}

// Given the name of a service and the array of profiles, return a link to that
// service that's styled appropriately (i.e. show a link or an image).
function getLink(prettyName, profiles) {
  var service = prettyName.toLowerCase();

  // If the user has a profile authorized for this service
  if (profiles && profiles[service] !== undefined) {
    return sprintf('<img class="connected" src="http://assets.singly.com/service-icons/32px/%s.png" title="%s: Connected" /> ' +
      '<span class="result"></span>', service, prettyName);
  }

  var queryString = querystring.stringify({
    client_id: process.env.SINGLY_CLIENT_ID,
    redirect_uri: sprintf('%s/callback', process.env.HOST_URL),
    service: service
  });

  return sprintf('<a class="clean-gray" href="%s/oauth/authorize?%s">' +
    '<img src="http://assets.singly.com/service-icons/32px/%s.png" title="%s" /> Authenticate %s</a>',
    process.env.API_URL,
    queryString,
    service,
    prettyName,
    prettyName);
}

// Create an HTTP server
var app = express.createServer();

// Setup for the express web framework
app.configure(function () {
  // Use ejs instead of jade because HTML is easy
  app.set('view engine', 'ejs');

  app.use(express.logger());
  app.use(express['static'](__dirname + '/public'));
  app.use(express.bodyParser());
  app.use(express.cookieParser());
  app.use(express.session({
    secret: process.env.SESSION_SECRET,
    store: new MongoStore({
      db: 'idego-sessions'
    })
  }));
  app.use(app.router);
});

// We want exceptions and stracktraces in development
app.configure('development', function () {
  app.use(express.errorHandler({
    dumpExceptions: true,
    showStack: true
  }));
});

// ... but not in production
app.configure('production', function () {
  app.use(express.errorHandler());
});

// Returns the user's profiles with IDs parsed to integers
function getParsedProfiles(req, cb) {
  getProtectedResource('/profiles', req.session, function (err, profilesBody) {
    _.each(profilesBody, function (value, key) {
      if (!Array.isArray(value)) {
        return;
      }

      profilesBody[key] = _.map(value, function (profile) {
        return parseInt(profile, 10);
      });
    });

    cb(profilesBody);
  });
}

// Returns the blended averages of a user's profiles
function blendedAverage(profiles) {
  var userSum = 0;
  var idSum = 0;
  var percentageSum = 0;
  var serviceCount = 0;

  // Require this here since it updates once a day
  var users = require('./public/users.json');

  // Weight the user's percentage and ID by the number of users the service has
  _.each(profiles, function (profile, service) {
    if (!Array.isArray(profile)) {
      return;
    }

    if (!users[service]) {
      return;
    }

    var id = parseInt(profile[0], 10);

    // Ten billion
    if (id > 10000000000) {
      return;
    }

    serviceCount++;

    userSum += users[service];
    percentageSum += (id / users[service]) * users[service];
    idSum += id * users[service];
  });

  return {
    id: Math.round(idSum / userSum),
    percentage: percentageSum / userSum,
    services: serviceCount
  };
}


// Updates the user's profiles, access token, and counterId
function updateProfiles(req, cb) {
  if (!req.session.access_token) {
    return cb();
  }

  getParsedProfiles(req, function (profilesBody) {
    req.session.profiles = profilesBody;

    var averages = blendedAverage(profilesBody);

    // XXX: This feels dirty.
    PROFILES.findOne({ _id: profilesBody.id }, function (err, profile) {
      // If the user has no saved profiles
      if (profile === null) {
        COUNTERS.findAndModify({ _id: "userId" },
          [], { $inc: { count: 1 } }, function (err, userId) {
          profile = {
            _id: profilesBody.id,
            counterId: userId.count,
            accessToken: req.session.access_token,
            username: req.session.username,
            profiles: profilesBody,
            blendedAverage: averages
          };

          PROFILES.insert(profile, { safe: true }, function (err) {
            if (err) {
              console.error('Error inserting', err);
            }

            req.session.counterId = profile.counterId;

            cb();
          });
        });
      } else {
        profile.accessToken = req.session.access_token;
        profile.username = req.session.username;
        profile.profiles = profilesBody;
        profile.blendedAverage = averages;

        PROFILES.update({ _id: profilesBody.id }, profile, { safe: true },
          function (err) {
          if (err) {
            console.error('Error updating', err);
          }

          req.session.counterId = profile.counterId;

          cb();
        });
      }
    });
  });
}

// Returns the total number of idego users
app.get('/users', function (req, res) {
  COUNTERS.findOne({ _id: "userId" }, function (err, userId) {
    res.json(userId.count);
  });
});

app.get('/leaderboard', function (req, res) {
  res.render('leaderboard', {
    pageClass: req.session.access_token ? 'authenticated' : '',
    isPublic: true,
    accessToken: req.session.access_token,
    profiles: req.session.profiles,
    counterId: req.session.counterId
  });
});

app.get('/leaderboard/:service', function (req, res) {
  if (!req.param('service')) {
    res.send(404);
  }

  var sort = -1;

  if (req.param('sort') !== undefined) {
    sort = parseInt(req.param('sort'), 10);
  }

  var key = 'profiles.' + req.param('service');
  var arrayKey = key + '.0';

  var sortKey = {};

  sortKey[arrayKey] = sort;

  var fields = ['username', 'counterId'];

  if (req.param('service') === 'blended') {
    key = 'blendedAverage.percentage';
    arrayKey = key;
    sortKey = {
      'blendedAverage.services': sort,
      'blendedAverage.percentage': sort === -1 ? 1 : -1
    };

    fields.push('blendedAverage');
    fields.push('profiles');
  } else {
    fields.push(key);
  }

  var query = {};

  query[arrayKey] = { $exists: true, $gt: -1 };

  PROFILES.find(query, fields)
    .sort(sortKey)
    .limit(50)
    .toArray(function (err, profiles) {
    res.send(profiles);
  });
});

function renderIndex(req, res, isPublic) {
  var services = [];

  // For each service in usedServices, get a link to authorize it
  usedServices.forEach(function (service) {
    services.push({
      name: service,
      link: getLink(service, req.session.profiles)
    });
  });

  // Render out views/index.ejs, passing in the array of links and the session
  res.render('index', {
    pageClass: req.session.access_token ? 'authenticated' : '',
    services: services,
    isPublic: isPublic,
    accessToken: req.session.access_token,
    profiles: req.session.profiles,
    counterId: req.session.counterId
  });
}

app.get('/', function (req, res) {
  // If the user has authorized any services...
  if (req.session.profiles) {
    // Retrieve the /profile endpoint from Singly
    getProtectedResource('/profile', req.session,
      function (err, profile) {
      // Get the user's full name from the Singly profile object
      req.session.username = (profile && profile.name) ? profile.name : '';

      updateProfiles(req, function () {
        renderIndex(req, res, false);
      });
    });
  } else {
    renderIndex(req, res, false);
  }
});

function getServices(profile) {
  var services = [];

  // For each service in usedServices, get the score
  usedServices.forEach(function (service) {
    services.push({
      name: service,
      html: sprintf('<img class="connected" ' +
        'src="http://assets.singly.com/service-icons/32px/%s.png" ' +
        'title="%s" /> <span class="result" data-service="%s" ' +
        'data-id="%s"></span>',
        service.toLowerCase(),
        service,
        service.toLowerCase(),
        profile.profiles[service.toLowerCase()] ?
        profile.profiles[service.toLowerCase()] : '')
    });
  });

  return services;
}

app.post('/username', function (req, res) {
  var accessToken = req.param('accessToken');
  var value = req.param('value');

  if (accessToken && value) {
    return PROFILES.update({ accessToken: accessToken },
      { $set: { username: value } },
      { safe: true },
      function (err) {
        if (err) return res.send(500);
        res.send(value);
      });
  }

  res.send(500);
});

app.get('/compare/:id/:comparisonId', function (req, res) {
  async.parallel({
    one: function (cb) {
      PROFILES.findOne({ counterId: parseInt(req.params.id, 10) },
        function (err, profile) {
        if (err || !profile) {
          return cb(err);
        }

        cb(null, profile);
      });
    },
    two: function (cb) {
      PROFILES.findOne({ _id: req.params.comparisonId },
        function (err, profile) {
        if (err || !profile) {
          return cb(err);
        }

        cb(null, profile);
      });
    }
  }, function (err, results) {
    if (err) {
      return res.send(404);
    }

    res.render('compare', {
      pageClass: req.session.access_token ? 'authenticated' : '',
      accessToken: req.session.access_token,
      counterId: req.session.counterId,
      isPublic: true,
      one: results.one,
      two: results.two,
      oneServices: getServices(results.one),
      twoServices: getServices(results.two)
    });
  });
});

app.get('/profiles/:id', function (req, res) {
  res.redirect('http://idego.co/profile/' + req.params.id);
});

app.get('/profile/:id', function (req, res) {
  if (!req.params.id) {
    return res.error(500);
  }

  PROFILES.findOne({ counterId: parseInt(req.params.id, 10) },
    function (err, profile) {
    var services = [];

    // For each service in usedServices, get the score
    usedServices.forEach(function (service) {
      if (profile.profiles[service.toLowerCase()]) {
        services.push({
          name: service,
          html: sprintf('<img class="connected" ' +
            'src="http://assets.singly.com/service-icons/32px/%s.png" ' +
            'title="%s" /> <span class="result" data-service="%s" ' +
            'data-id="%s"></span>',
            service.toLowerCase(),
            service,
            service.toLowerCase(),
            profile.profiles[service.toLowerCase()])
        });
      }
    });

    var counterId = parseInt(req.params.id, 10);

    res.render('profile', {
      accessToken: req.session.access_token,
      isPublic: true,
      services: services,
      username: profile.username,
      counterId: counterId,
      mine: counterId === req.session.counterId
    });
  });
});

app.get('/callback', function (req, res) {
  var data = {
    client_id: process.env.SINGLY_CLIENT_ID,
    client_secret: process.env.SINGLY_CLIENT_SECRET,
    code: req.param('code')
  };

  request.post({
    uri: sprintf('%s/oauth/access_token', process.env.API_URL),
    body: querystring.stringify(data),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  }, function (err, resp, body) {
    try {
      body = JSON.parse(body);
    } catch (parseErr) {
      console.error('Parse error: ' + parseErr);
      console.error('body: ' + body);

      return res.redirect(process.env.HOST_URL + '/');
    }

    req.session.access_token = body.access_token;

    updateProfiles(req, function () {
      res.redirect(process.env.HOST_URL + '/');
    });
  });
});

initDb(function () {
  app.listen(process.env.PORT);
});
