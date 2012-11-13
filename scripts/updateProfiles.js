db.profiles.find().forEach(function (profile) {
  for (var key in profile.profiles) {
    if (key === 'id') {
      continue;
    }

    var newProfiles = [];

    for (var p in profile.profiles[key]) {
      newProfiles.push(parseInt(profile.profiles[key][p], 10));
    }

    profile.profiles[key] = newProfiles;
  }

  db.profiles.save(profile);
});
