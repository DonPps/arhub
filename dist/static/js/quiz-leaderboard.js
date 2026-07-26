/* Atlas Quiz — classement public (leaderboard).
 *
 * Collection Firestore "leaderboard/{uid}" : SEUL endroit du site où un
 * pseudo est rendu public (associé à un score), par choix explicite de
 * l'utilisateur — un classement de jeu est intrinsèquement public,
 * contrairement au reste du profil (bio, email) qui reste privé. Chacun
 * n'écrit jamais que son propre document (voir firestore.rules), mais
 * tout le monde peut lire l'ensemble du classement.
 *
 * Points = (rangs solo validés × 20) + (duels gagnés × 10) + (duels
 * joués × 2). Recalculé intégralement à chaque appel plutôt qu'incrémenté,
 * pour rester simple et toujours cohérent avec l'état réel de
 * quizProgress/quizDuels — appelé après une validation de rang (quiz.js)
 * ou la fin d'un duel (quiz-duel.js).
 */

export function refreshLeaderboardEntry(db, firestoreFns, user) {
  var uid = user.uid;
  var progressRef = firestoreFns.doc(db, 'quizProgress', uid);
  var userRef = firestoreFns.doc(db, 'users', uid);
  var qHost = firestoreFns.query(firestoreFns.collection(db, 'quizDuels'), firestoreFns.where('hostUid', '==', uid), firestoreFns.where('status', '==', 'finished'));
  var qGuest = firestoreFns.query(firestoreFns.collection(db, 'quizDuels'), firestoreFns.where('guestUid', '==', uid), firestoreFns.where('status', '==', 'finished'));

  return Promise.all([
    firestoreFns.getDoc(progressRef).then(function (s) { return s.exists() ? s.data() : {}; }).catch(function () { return {}; }),
    firestoreFns.getDoc(userRef).then(function (s) { return s.exists() ? s.data() : {}; }).catch(function () { return {}; }),
    firestoreFns.getDocs(qHost).catch(function () { return null; }),
    firestoreFns.getDocs(qGuest).catch(function () { return null; }),
  ]).then(function (results) {
    var progress = results[0], userData = results[1];
    var duels = [];
    if (results[2]) results[2].forEach(function (d) { duels.push(d.data()); });
    if (results[3]) results[3].forEach(function (d) { duels.push(d.data()); });

    var completedRanks = Object.keys(progress).filter(function (slug) {
      return progress[slug] && progress[slug].completed;
    }).length;
    var wins = duels.filter(function (d) { return d.winnerUid === uid; }).length;
    var points = completedRanks * 20 + wins * 10 + duels.length * 2;
    var nickname = userData.nickname || user.displayName || (user.email || 'Joueur').split('@')[0];

    var ref = firestoreFns.doc(db, 'leaderboard', uid);
    return firestoreFns.setDoc(ref, { nickname: nickname, points: points, updatedAt: firestoreFns.serverTimestamp() }, { merge: true });
  }).catch(function (e) { console.error('refreshLeaderboardEntry failed:', e); });
}

export function loadTopPlayers(db, firestoreFns, count) {
  var q = firestoreFns.query(
    firestoreFns.collection(db, 'leaderboard'),
    firestoreFns.orderBy('points', 'desc'),
    firestoreFns.limit(count || 20)
  );
  return firestoreFns.getDocs(q).then(function (snap) {
    var rows = [];
    snap.forEach(function (d) { rows.push(d.data()); });
    return rows;
  }).catch(function () { return []; });
}
