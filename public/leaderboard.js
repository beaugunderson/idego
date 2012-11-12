/*global commas:true*/

$(function () {
  var service = window.location.pathname.replace('/leaderboard/', '');

  $.getJSON('/leaderboard.json?service=' + service, function (leaderboard) {
    _.each(leaderboard, function (leader) {
      var services = '';
      var result;

      if (service === 'blended') {
        services = '<td>' + leader.blendedAverage.services + '</td>';
        result = Math.round(leader.blendedAverage.percentage * 100 * 100) / 100 + '%';
      } else {
        result = commas(leader.profiles[service][0]);
      }

      $('#leaderboard').append('<tr>' +
          '<td><a href="/profile/' + leader.counterId + '">' + leader.username + '</a></td>' +
          services +
          '<td>' + result + '</td>' +
        '</tr>');
    });
  });
});
