/* Dream Team — classement public par valeur d'équipe (dreamTeams/{uid}.value).
 * Même principe que static/js/quiz-leaderboard.js : le classement est une
 * simple requête publique triée, aucune donnée sensible en jeu. */

export function loadTopDreamTeams(db, firestoreFns, count) {
  var q = firestoreFns.query(
    firestoreFns.collection(db, 'dreamTeams'),
    firestoreFns.orderBy('value', 'desc'),
    firestoreFns.limit(count || 20)
  );
  return firestoreFns.getDocs(q).then(function (snap) {
    var rows = [];
    snap.forEach(function (d) { rows.push({ uid: d.id, nickname: d.data().nickname, value: d.data().value || 0 }); });
    return rows;
  }).catch(function () { return []; });
}
