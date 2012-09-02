var express = require('express');
var fs = require('fs');
var querystring = require('querystring');
var request = require('request');
var util = require('util');
var sprintf = require('sprintf').sprintf;
var _ = require('underscore');
var OAuth2 = require('oauth').OAuth2;

var MongoStore = require('connect-mongo')(express);

var mongo = require('mongodb');

var server = new mongo.Server('localhost', 27017, { auto_reconnect: true });
var db = new mongo.Db('idego', server);

var idego;
var profiles;
var counters;

var apiBaseUrl = 'https://api.singly.com';
var hostBaseUrl = 'http://idego.co';

// The port that this express app will listen on
var port = 8047;

var config = JSON.parse(fs.readFileSync('config.json'));

db.open(function(err, idegoDb) {
   if (err) {
      console.error("Error: " + err);
   }

   idego = idegoDb;

   idego.createCollection('profiles', function(err, profilesCollection) {
      profiles = profilesCollection;

      idego.createCollection('counters', function(err, countersCollection) {
         counters = countersCollection;
      });
   });
});

var usedServices = [
   'Instagram',
   'foursquare',
   'GitHub',
   'Twitter'
   //'Facebook',
   //'RunKeeper',
];

var oa = new OAuth2(config.clientId, config.clientSecret, apiBaseUrl);

// A convenience method that takes care of adding the access token to requests
function getProtectedResource(path, session, callback) {
   oa.getProtectedResource(apiBaseUrl + path, session.access_token, callback);
}

// Given the name of a service and the array of profiles, return a link to that
// service that's styled appropriately (i.e. show a link or a checkmark).
function getLink(prettyName, profiles) {
   var service = prettyName.toLowerCase();

   // If the user has a profile authorized for this service
   if (profiles && profiles[service] !== undefined) {
      // Return a unicode checkmark so that the user doesn't try to authorize it again
      return sprintf('<img class="connected" src="/images/%s.png" title="%s: Connected" /> <span class="result"></span>', service, prettyName);
   }

   // This flow is documented here: http://dev.singly.com/authorization
   var queryString = querystring.stringify({
      client_id: config.clientId,
      redirect_uri: sprintf('%s/callback', hostBaseUrl),
      service: service
   });

   return sprintf('<a class="clean-gray" href="%s/oauth/authorize?%s"><img src="/images/%s.png" title="%s" /> Authenticate</a>',
      apiBaseUrl,
      queryString,
      service,
      prettyName);
}

// Create an HTTP server
var app = express.createServer();

// Setup for the express web framework
app.configure(function() {
   // Use ejs instead of jade because HTML is easy
   app.set('view engine', 'ejs');

   app.use(express.logger());
   app.use(express.static(__dirname + '/public'));
   app.use(express.bodyParser());
   app.use(express.cookieParser());
   app.use(express.session({
      secret: config.sessionSecret,
      store: new MongoStore({
         db: 'idego-sessions'
      })
   }));
   app.use(app.router);
});

// We want exceptions and stracktraces in development
app.configure('development', function() {
   app.use(express.errorHandler({
      dumpExceptions: true,
      showStack: true
   }));
});

// ... but not in production
app.configure('production', function() {
   app.use(express.errorHandler());
});

function updateProfiles(req, cb) {
   if (req.session.access_token) {
      getProtectedResource('/profiles', req.session, function(err, profilesBody) {
         try {
            profilesBody = JSON.parse(profilesBody);
         } catch(parseErr) {
         }

         req.session.profiles = profilesBody;

         // XXX: This feels dirty.
         profiles.findOne({ _id: profilesBody.id }, function(err, profile) {
            var userId;

            if (profile === null) {
               counters.findAndModify({ _id: "userId" },
                  [], { $inc: { count: 1 } }, function(err, userId) {
                  profile = {
                     _id: profilesBody.id,
                     username: req.session.username,
                     counterId: userId.count,
                     profiles: profilesBody
                  };

                  profiles.insert(profile, { safe: true }, function(err, result) {
                     req.session.counterId = profile.counterId;

                     cb();
                  });
               });
            } else {
               profile.profiles = profilesBody;
               profile.username = req.session.username;

               profiles.update({ _id: profilesBody.id }, profile, { safe: true }, function(err, result) {
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

app.get('/users', function(req, res) {
   counters.findOne({ _id: "userId" }, function(err, userId) {
      res.json(userId.count);
   });
});

app.get('/', function(req, res) {
   if (req.session.profiles) {
      getProtectedResource('/types/statuses?map=true', req.session, function(err, statuses) {
         try {
            statuses = JSON.parse(statuses);
         } catch(parseErr) {
         }

         var username;

         if (statuses &&
            statuses.length &&
            statuses[0].map &&
            statuses[0].map.author &&
            statuses[0].map.author.name) {
            username = statuses[0].map.author.name;
         }

         req.session.username = username;

         updateProfiles(req, function() {
            var i;
            var services = [];

            // For each service in usedServices, get a link to authorize it
            for (i = 0; i < usedServices.length; i++) {
               services.push({
                  name: usedServices[i],
                  link: getLink(usedServices[i], req.session.profiles)
               });
            }

            // Render out views/index.ejs, passing in the array of links and the session
            res.render('index', {
               services: services,
               isPublic: false,
               accessToken: req.session.access_token,
               profiles: req.session.profiles,
               counterId: req.session.counterId
            });
         });
      });
   } else {
      var i;
      var services = [];

      // For each service in usedServices, get a link to authorize it
      for (i = 0; i < usedServices.length; i++) {
         services.push({
            name: usedServices[i],
            link: getLink(usedServices[i], req.session.profiles)
         });
      }

      // Render out views/index.ejs, passing in the array of links and the session
      res.render('index', {
         services: services,
         isPublic: false,
         accessToken: req.session.access_token,
         profiles: req.session.profiles,
         counterId: req.session.counterId
      });
   }
});

app.get('/profiles/:id', function(req, res) {
   res.redirect('http://idego.co/profile/' + req.params.id);
});

app.get('/profile/:id', function(req, res) {
   if (!req.params.id) {
      return res.error(500);
   }

   profiles.findOne({ counterId: parseInt(req.params.id, 10) }, function(err, profile) {
      var services = [];

      // For each service in usedServices, get the score
      for (i = 0; i < usedServices.length; i++) {
         if (profile.profiles[usedServices[i].toLowerCase()]) {
            services.push({
               name: usedServices[i],
               html: sprintf('<img class="connected" src="/images/%s.png" title="%s" /> <span class="result" data-service="%s" data-id="%s"></span>',
                  usedServices[i].toLowerCase(),
                  usedServices[i],
                  usedServices[i].toLowerCase(),
                  profile.profiles[usedServices[i].toLowerCase()])
            });
         }
      }

      res.render('profile', {
         accessToken: undefined,
         isPublic: true,
         services: services,
         username: profile.username,
         counterId: parseInt(req.params.id, 10)
      });
   });
});

app.get('/callback', function(req, res) {
   var data = {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: req.param('code')
   };

   request.post({
      uri: sprintf('%s/oauth/access_token', apiBaseUrl),
      body: querystring.stringify(data),
      headers: {
         'Content-Type': 'application/x-www-form-urlencoded'
      }
   }, function(err, resp, body) {
      try {
         body = JSON.parse(body);
      } catch(parseErr) {
         console.error('Parse error: ' + parseErr);
         console.error('body: ' + body);

         return res.redirect(hostBaseUrl + '/');
      }

      req.session.access_token = body.access_token;

      updateProfiles(req, function() {
         res.redirect(hostBaseUrl + '/');
      });
   });
});

app.listen(port);
