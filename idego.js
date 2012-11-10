var express = require('express');
var OAuth2 = require('oauth').OAuth2;
var querystring = require('querystring');
var request = require('request');
var sprintf = require('sprintf').sprintf;
var _ = require('underscore');

var MongoStore = require('connect-mongo')(express);

var mongo = require('mongodb');

var server = new mongo.Server('localhost', 27017, { auto_reconnect: true });
var db = new mongo.Db('idego', server);

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

// Updates the user's profiles, access token, and counterId
function updateProfiles(req, cb) {
  if (!req.session.access_token) {
    return cb();
  }

  getParsedProfiles(req, function (profilesBody) {
    req.session.profiles = profilesBody;

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
            profiles: profilesBody
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

app.get('/leaderboard/:service', function (req, res) {
  if (!req.param('service')) {
    res.send(404);
  }

  var key = 'profiles.' + req.param('service');

  var fields = ['username', 'counterId', key];

  var query = {};

  query[key + '.0'] = { $exists: true, $gt: -1 };

  PROFILES.find(query, fields).sort(key + '.0').limit(50).toArray(function (err,
    profiles) {
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

    res.render('profile', {
      accessToken: undefined,
      isPublic: true,
      services: services,
      username: profile.username,
      counterId: parseInt(req.params.id, 10)
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
