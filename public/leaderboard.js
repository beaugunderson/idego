$(function () {
  $.getJSON('/leaderboard/blended', function (leaderboard) {
    _.each(leaderboard, function (leader) {
      $('#leaderboard').append('<tr>' +
          '<td><a href="/profile/' + leader.counterId + '">' + leader.username + '</a></td>' +
          '<td>' + Math.round(leader.blendedAverage.percentage * 100 * 100) / 100 + '%</td>' +
          '<td>' + leader.blendedAverage.services + '</td>' +
        '</tr>');
    });
  });
});
