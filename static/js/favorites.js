/* Atlas Rising — favoris (équipes + compétitions), partagé entre la page
 * Matchs (bouton favori) et la page Profil (liste/suppression).
 *
 * Un seul document par utilisateur : favorites/{uid} = { teams: [...],
 * competitions: [...] } — mêmes principes que users/{uid} (privé,
 * jamais lu par un autre utilisateur, voir firestore.rules).
 */

export function loadFavorites(db, firestoreFns, uid) {
  var ref = firestoreFns.doc(db, 'favorites', uid);
  return firestoreFns.getDoc(ref)
    .then(function (snap) { return snap.exists() ? snap.data() : {}; })
    .then(function (data) {
      return { teams: data.teams || [], competitions: data.competitions || [] };
    })
    .catch(function () { return { teams: [], competitions: [] }; });
}

/* type: 'teams' ou 'competitions'. Retourne le nouvel état (true = ajouté). */
export function toggleFavorite(db, firestoreFns, uid, type, name) {
  var ref = firestoreFns.doc(db, 'favorites', uid);
  return firestoreFns.getDoc(ref).then(function (snap) {
    var data = snap.exists() ? snap.data() : {};
    var list = data[type] || [];
    var idx = list.indexOf(name);
    var isFavorite;
    if (idx === -1) {
      list = list.concat([name]);
      isFavorite = true;
    } else {
      list = list.slice(0, idx).concat(list.slice(idx + 1));
      isFavorite = false;
    }
    var update = {};
    update[type] = list;
    return firestoreFns.setDoc(ref, update, { merge: true }).then(function () { return isFavorite; });
  });
}

export function removeFavorite(db, firestoreFns, uid, type, name) {
  var ref = firestoreFns.doc(db, 'favorites', uid);
  return firestoreFns.getDoc(ref).then(function (snap) {
    var data = snap.exists() ? snap.data() : {};
    var list = (data[type] || []).filter(function (n) { return n !== name; });
    var update = {};
    update[type] = list;
    return firestoreFns.setDoc(ref, update, { merge: true });
  });
}
