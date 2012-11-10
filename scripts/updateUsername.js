var async = require('async');
var mongo = require('mongodb');
var request = require('request');

var server = new mongo.Server('localhost', 27017, { auto_reconnect: true });

var db = new mongo.Db('idego', server, { safe: true });

db.open(function (err, idegoDb) {
  idegoDb.createCollection('profiles', function (err, profiles) {
    profiles.find().toArray(function (err, array) {
      console.log('Updating', array.length, 'profiles');

      async.forEachLimit(array, 10, function (profile, cb) {
        if (profile && profile.accessToken) {
          request.get({
            uri: 'https://api.singly.com/profile?access_token=' +
              profile.accessToken,
            json: true
          }, function (err, res, body) {
            console.log('Updating', profile.username, 'to', body.name);

            profiles.update({ _id: profile._id },
              { $set: { username: body.name } },
              { safe: true },
              function (err) {
                if (err) console.warn(err.message);

                cb();
              });
          });
        } else {
          console.log('Skipping', profile._id);

          process.nextTick(cb);
        }
      });
    });
  });
});
