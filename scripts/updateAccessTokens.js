var mongo = require('mongodb');

var server1 = new mongo.Server('localhost', 27017, { auto_reconnect: true });
var server2 = new mongo.Server('localhost', 27017, { auto_reconnect: true });

var db = new mongo.Db('idego', server1, { safe: true });
var dbSessions = new mongo.Db('idego-sessions', server2, { safe: true });

db.open(function (err, idegoDb) {
  dbSessions.open(function (err, sessionsDb) {
    idegoDb.createCollection('profiles', function (err, profiles) {
      sessionsDb.createCollection('sessions', function (err, sessions) {
        var cursor = sessions.find();

        cursor.each(function (err, session) {
          if (session) {
            var s;

            try {
              s = JSON.parse(session.session);
            } catch (e) {
            }

            if (s && s.access_token &&
              s.profiles && s.profiles.id) {
              console.log('Updating', s.profiles.id);

              profiles.update({ _id: s.profiles.id },
                { $set: { accessToken: s.access_token } },
                { safe: true },
                function (err) {
                  if (err) console.warn(err.message);

                  else console.log('successfully updated');
                });
            }
          }
        });
      });
    });
  });
});
