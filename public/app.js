/*global accessToken:true isPublic:true Spinner:true counterId:true*/

var baseUrl = 'https://api.singly.com';

var singly = {
  get: function (url, options, callback) {
    if (options === undefined ||
      options === null) {
      options = {};
    }

    options.access_token = accessToken;

    $.getJSON(baseUrl + url, options, callback);
  }
};

var spinnerOptions = {
  lines: 10,
  length: 4,
  width: 1.5,
  radius: 3,
  rotate: 0,
  color: 'white',
  speed: 1,
  trail: 60,
  shadow: false,
  hwaccel: true,
  className: 'spinner',
  zIndex: 1e3,
  top: 15,
  left: 90
};

var spinners = {};

function commas(number) {
  return String(number).replace(/(^|[^\w.])(\d{4,})/g, function ($0, $1, $2) {
    return $1 + $2.replace(/\d(?=(?:\d\d\d)+(?!\d))/g, "$&,");
  });
}

function instagramFriends(userId, cb) {
  singly.get('/services/instagram/follows', { fields: 'data.id', limit: 5000 },
    function  (instagram) {
    var ids = _.map(instagram, function (friend) {
      return parseInt(friend['data.id'], 10);
    }).sort(function (a, b) { return a - b; });

    var i;
    for (i = 0; i < ids.length; i++) {
      if (userId < ids[i]) {
        var percentage = Math.round((((i + 1) / ids.length) * 100) * 100) / 100;

        return cb('Among the <span class="accent">' + commas(ids.length) +
          '</span> people you follow your rank is <span class="accent">' +
          commas(i + 1) + '</span> (<span class="accent">' + percentage +
          '%</span>).');
      }
    }
  });
}

function twitterFriends(userId, cb) {
  singly.get('/services/twitter/friends', { fields: 'data.id', limit: 5000 },
    function (twitter) {
    var ids = _.map(twitter, function (friend) {
      return friend['data.id'];
    }).sort(function (a, b) { return a - b; });

    var i;
    for (i = 0; i < ids.length; i++) {
      if (userId < ids[i]) {
        var percentage = Math.round((((i + 1) / ids.length) * 100) * 100) / 100;

        return cb('Among the <span class="accent">' + commas(ids.length) +
          '</span> people you follow your rank is <span class="accent">' +
          commas(i + 1) + '</span> (<span class="accent">' + percentage +
          '%</span>).');
      }
    }
  });
}

function foursquareFriends(userId, cb) {
  singly.get('/services/foursquare/friends', {
    fields: 'data.id,data.relationship',
    limit: 5000
  }, function (foursquare) {
    foursquare = _.filter(foursquare, function (friend) {
      return friend['data.relationship'] === 'friend';
    });

    var ids = _.map(foursquare, function (friend) {
      return friend['data.id'];
    }).sort(function (a, b) { return a - b; });

    var i;
    for (i = 0; i < ids.length; i++) {
      if (userId < ids[i]) {
        var percentage = Math.round((((i + 1) / ids.length) * 100) * 100) / 100;

        return cb('Among your <span class="accent">' + commas(ids.length) +
          '</span> friends your rank is <span class="accent">' + commas(i + 1) +
          '</span> (<span class="accent">' + percentage + '%</span>).');
      }
    }
  });
}

var extendedResults = {
  twitter: twitterFriends,
  foursquare: foursquareFriends,
  instagram: instagramFriends
};

var serviceNames = {
  foursquare: 'foursquare',
  github: 'GitHub',
  instagram: 'Instagram',
  klout: 'Klout',
  meetup: 'Meetup',
  runkeeper: 'RunKeeper',
  stocktwits: 'StockTwits',
  twitter: 'Twitter'
};

function blendedAverage(profiles, users) {
  var userSum = 0;
  var idSum = 0;
  var percentageSum = 0;

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

    userSum += users[service];
    percentageSum += (id / users[service]) * users[service];
    idSum += id * users[service];
  });

  return {
    id: Math.round(idSum / userSum),
    percentage: percentageSum / userSum
  };
}

function doPublic(users) {
  // XXX: Better logic here.
  if ($('ul.profile').length === 2) {
    $('ul.profile').each(function () {
      var profiles = {};

      $(this).find('.result').each(function () {
        var id = parseInt($(this).attr('data-id'), 10);
        var service = $(this).attr('data-service');

        if (!id) {
          $(this).html('None');

          return;
        }

        profiles[service] = [id];

        var percentage = Math.round(((id / users[service]) * 100) * 100) / 100;

        $(this).html('<span class="accent">' + commas(id) +
          '</span> (<span class="accent">' + percentage + '%</span>)');
      });

      var average = blendedAverage(profiles, users);

      $(this).append('<li class="centered">Average: ' +
          Math.round((average.percentage * 100) * 100) / 100 + '%' +
        '</li>');
    });

    return;
  }

  if (accessToken !== 'undefined' &&
    accessToken !== undefined) {
    $('#username.mine').editable('/username', {
      submitdata: {
        accessToken: accessToken
      },
      callback: function (value) {
        $('#username').text(value);
      }
    });
  }

  $('.result').each(function () {
    var id = parseInt($(this).attr('data-id'), 10);
    var service = $(this).attr('data-service');

    var percentage = Math.round(((id / users[service]) * 100) * 100) / 100;

    $(this).html('User <span class="accent">' + commas(id) +
      '</span>: In the first <span class="accent">' + percentage +
      '%</span> of users.');
  });

  return;
}

function doFriends() {
  singly.get('/friends/peers', { sort: 'connected' }, function (friends) {
    friends.forEach(function (friend) {
      $('#friends-list').append(sprintf('<li><a href="%s" title="%s">' +
          '<span class="image-wrap card" style="background-image: url(%s);" /> ' +
        '</a></li>',
        '/compare/' + counterId + '/' + friend.peer,
        friend.name,
        friend.thumbnail_url));
    });

    if (friends.length > 4) {
      $('#friends-more a').click(function () {
        $('#friends').toggleClass('more');

        $('#friends-more a').text(
          $('#friends-more a').text() === 'Show all' ? 'Close' : 'Show all');
      });

      $('#friends-more').css('display', 'table-cell');
    }

    if (friends.length) {
      $('#friends').show();
    }
  });
}

$(function () {
  $('#ajax-error').ajaxError(function (e, jqxhr, settings, exception) {
    $(this).show();

    $('#ajax-error-details').html(sprintf(
      '<strong>URL:</strong> %s<br />' +
      '<strong>Exception:</strong> %s<br />',
      settings.url,
      exception));
  });

  $.getJSON('/users.json', function (users) {
    if (isPublic) {
      doPublic(users);
      doFriends();

      return;
    }

    if (accessToken === 'undefined' ||
      accessToken === undefined) {
      return;
    }

    doFriends();

    singly.get('/profiles', null, function (profiles) {
      var average = blendedAverage(profiles, users);

      $('#average-id').text(commas(average.id));

      $('#average-percentage').text(Math.round((average.percentage * 100) * 100) / 100 + '%');
      $('#average-percentage-inverse').text(Math.round(((1 - average.percentage) * 100) * 100) / 100 + '%');

      $('#averages').show();

      var lowest = 100;
      var twitterText = '';

      _.each(profiles, function (profile, service) {
        if (!Array.isArray(profile)) {
          return;
        }

        var percentage = Math.round((parseInt(profile[0], 10) / users[service]) * 100 * 100) / 100;

        // Let the user tweet their best score
        if (percentage < lowest) {
          lowest = percentage;

          twitterText = "I was within the first " + percentage +
            "% of users to join " + serviceNames[service] + "!";
        }

        $('#' + service + ' .result').html('User <span class="accent">' +
          commas(profile[0]) + '</span>: You\'re in the first ' +
          '<span class="accent">' + percentage + '%</span> of users.');

        if (extendedResults[service] !== undefined) {
          $('#' + service + ' .result').append(
            '<div class="extended">Loading...</div>');

          spinners[service] = new Spinner(spinnerOptions).spin($('#' +
            service + ' .result .extended').get(0));

          extendedResults[service](profile[0], function (extendedResult) {
            spinners[service].stop();

            $('#' + service + ' .result .extended').html(extendedResult);
          });
        }
      });

      $.getJSON('/users', function (users) {
        var percentage = Math.round((counterId / users) * 100 * 100) / 100;

        $('#idego').html('You\'re also within the first <span class="accent">' +
          percentage  + '%</span> of idego users. ;)');
      });

      if (twitterText) {
        $('#twitter-text-wrapper').show();

        $('#twitter-text').text(twitterText);

        $('#twitter-share-best').attr('data-text', twitterText);
        $('#twitter-share-best').attr('data-url', 'http://idego.co/profile/' +
          counterId);
      }

      $('#profile-link').html('Share your public profile with a friend: ' +
        '<a href="/profile/' + counterId + '">http://idego.co/profile/' +
        counterId + '</a>');

      $.getScript("//platform.twitter.com/widgets.js");
    });
  });
});
