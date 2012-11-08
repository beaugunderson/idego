var express = require('express');
var querystring = require('querystring');
var request = require('request');
var sprintf = require('sprintf').sprintf;
var OAuth2 = require('oauth').OAuth2;

var MongoStore = require('connect-mongo')(express);

var mongo = require('mongodb');

var server = new mongo.Server('localhost', 27017, { auto_reconnect: true });
var db = new mongo.Db('idego', server);

var idego;
var profiles;
var counters;

db.open(function (err, idegoDb) {
  if (err) {
    console.error("Error: " + err);
  }

  idego = idegoDb;

  idego.createCollection('profiles', function (err, profilesCollection) {
    profiles = profilesCollection;

    idego.createCollection('counters', function (err, countersCollection) {
      counters = countersCollection;
    });
  });
});

var usedServices = [
  //'Facebook',
  'foursquare',
  'GitHub',
  'Instagram',
  'Klout',
  'Meetup',
  //'RunKeeper',
  'StockTwits',
  'Twitter'
];

var oa = new OAuth2(process.env.SINGLY_CLIENT_ID,
  process.env.SINGLY_CLIENT_SECRET, process.env.API_URL);

// A convenience method that takes care of adding the access token to requests
function getProtectedResource(path, session, callback) {
  oa.getProtectedResource(process.env.API_URL + path, session.access_token, callback);
}

// Given the name of a service and the array of profiles, return a link to that
// service that's styled appropriately (i.e. show a link or an image).
function getLink(prettyName, profiles) {
  var service = prettyName.toLowerCase();

  // If the user has a profile authorized for this service
  if (profiles && profiles[service] !== undefined) {
    return sprintf('<img class="connected" src="http://assets.singly.com/service-icons/32px/%s.png" title="%s: Connected" /> <span class="result"></span>', service, prettyName);
  }

  var queryString = querystring.stringify({
    client_id: process.env.SINGLY_CLIENT_ID,
    redirect_uri: sprintf('%s/callback', process.env.HOST_URL),
    service: service
  });

  return sprintf('<a class="clean-gray" href="%s/oauth/authorize?%s"><img src="http://assets.singly.com/service-icons/32px/%s.png" title="%s" /> Authenticate %s</a>',
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

function updateProfiles(req, cb) {
  if (req.session.access_token) {
    getProtectedResource('/profiles', req.session, function (err, profilesBody) {
      try {
        profilesBody = JSON.parse(profilesBody);
      } catch (parseErr) {
      }

      req.session.profiles = profilesBody;

      // XXX: This feels dirty.
      profiles.findOne({ _id: profilesBody.id }, function (err, profile) {
        if (profile === null) {
          counters.findAndModify({ _id: "userId" },
            [], { $inc: { count: 1 } }, function (err, userId) {
            profile = {
              _id: profilesBody.id,
              username: req.session.username,
              counterId: userId.count,
              profiles: profilesBody
            };

            profiles.insert(profile, { safe: true }, function (err, result) {
              req.session.counterId = profile.counterId;

              cb();
            });
          });
        } else {
          profile.profiles = profilesBody;
          profile.username = req.session.username;

          profiles.update({ _id: profilesBody.id }, profile, { safe: true },
            function (err, result) {
            req.session.counterId = profile.counterId;

            cb();
          });
        }
      });
    });
  } else {
    cb();
  }
}

app.get('/users', function (req, res) {
  counters.findOne({ _id: "userId" }, function (err, userId) {
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
      try {
        profile = JSON.parse(profile);
      } catch (parseErr) {
      }

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

  profiles.findOne({ counterId: parseInt(req.params.id, 10) },
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

app.listen(process.env.PORT);
