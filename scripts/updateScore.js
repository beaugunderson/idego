var async = require('async');
var mongo = require('mongodb');
var _ = require('underscore');

var server = new mongo.Server('localhost', 27017, { auto_reconnect: true });

var db = new mongo.Db('idego', server, { safe: true });

var users = require('../public/users.json');

function blendedAverage(profiles, users) {
  var userSum = 0;
  var idSum = 0;
  var percentageSum = 0;
  var serviceCount = 0;

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

db.open(function (err, idegoDb) {
  idegoDb.createCollection('profiles', function (err, profiles) {
    profiles.find().toArray(function (err, array) {
      console.log('Updating', array.length, 'profiles');

      var i = 0;

      async.forEachLimit(array, 10, function (profile, cb) {
        if (i % 100) {
          process.stdout.write('.');
        }

        i++;

        if (profile) {
          var averages = blendedAverage(profile.profiles, users);

          profiles.update({ _id: profile._id },
            { $set: { blendedAverage: averages } },
            { safe: true },
            function (err) {
              if (err) console.warn(err.message);

              cb();
            });
        } else {
          process.nextTick(cb);
        }
      });
    });
  });
});
