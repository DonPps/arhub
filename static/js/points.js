/* Atlas Rising — Atlas Points (gain, achats, équipement).
 *
 * Module partagé par toutes les pages qui accordent des points (article,
 * quiz, matches, podcast...) et par la boutique/collection. Un seul
 * document Firestore par utilisateur (points/{uid}) — voir firestore.rules
 * pour le détail des règles anti-triche (chaque écriture ici doit rester
 * strictement dans les cas que les règles autorisent).
 */

import { firebaseConfigured, firebaseAppPromise } from './firebase-config.js';
import { POINTS_VALUES } from './points-config.js';

var db = null;
var firestoreFns = null;
var dbReadyPromise = null;

export function ensureFirestore() {
  if (dbReadyPromise) return dbReadyPromise;
  if (!firebaseConfigured) { dbReadyPromise = Promise.resolve(false); return dbReadyPromise; }
  dbReadyPromise = firebaseAppPromise.then(function (app) {
    return import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js').then(function (mod) {
      db = mod.initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
      firestoreFns = mod;
      return true;
    });
  });
  return dbReadyPromise;
}

export function getFirestoreRefs() {
  return { db: db, firestoreFns: firestoreFns };
}

function currentUser() {
  return (window.AtlasAuth && window.AtlasAuth.isConfigured() && window.AtlasAuth.getCurrentUser()) || null;
}

function ensurePointsDoc(uid) {
  var ref = firestoreFns.doc(db, 'points', uid);
  return firestoreFns.getDoc(ref).then(function (snap) {
    if (snap.exists()) return ref;
    return firestoreFns.setDoc(ref, { balance: 0, credited: {}, ownedPacks: {}, ownedItems: {} }).then(function () { return ref; });
  });
}

/* Crédite une action une seule fois (actionKey doit être unique par
 * action réelle, ex. "article-<slug>", "match-2026-07-28",
 * "quiz-correct-<rankSlug>-<questionIndex>"). Ne fait rien si déjà
 * créditée ou si l'utilisateur n'est pas connecté. */
export function awardPoints(actionType, actionKey) {
  var user = currentUser();
  var value = POINTS_VALUES[actionType];
  if (!user || !value || !actionKey) return Promise.resolve(false);

  return ensureFirestore().then(function (ok) {
    if (!ok) return false;
    return ensurePointsDoc(user.uid).then(function (ref) {
      return firestoreFns.getDoc(ref).then(function (snap) {
        var data = snap.data() || {};
        if (data.credited && data.credited[actionKey]) return false;
        var update = {};
        update.balance = firestoreFns.increment(value);
        update['credited.' + actionKey] = true;
        update.lastAction = { type: 'earn', key: actionKey };
        return firestoreFns.updateDoc(ref, update).then(function () {
          document.dispatchEvent(new CustomEvent('atlas-points-changed'));
          return true;
        });
      });
    });
  }).catch(function (e) { console.error('awardPoints failed:', e); return false; });
}

/* À appeler une fois par chargement de page sur atlas-auth-changed —
 * crédite la connexion du jour + tient la série (streak), idempotent. */
export function handleDailyLogin() {
  var user = currentUser();
  if (!user) return;
  ensureFirestore().then(function (ok) {
    if (!ok) return;
    ensurePointsDoc(user.uid).then(function (ref) {
      firestoreFns.getDoc(ref).then(function (snap) {
        var data = snap.data() || {};
        var today = new Date().toISOString().slice(0, 10);
        if (data.lastLoginDate === today) return;

        var yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        var newStreak = (data.lastLoginDate === yesterday) ? (data.loginStreak || 0) + 1 : 1;

        firestoreFns.updateDoc(ref, {
          lastLoginDate: today,
          loginStreak: newStreak,
          lastAction: { type: 'login', key: today },
        }).then(function () {
          awardPoints('daily_login', 'daily-' + today);
          if (newStreak > 0 && newStreak % 7 === 0) {
            awardPoints('login_streak_bonus', 'streak-' + today);
          }
        });
      });
    });
  });
}

export function loadPoints(uid) {
  return ensureFirestore().then(function (ok) {
    if (!ok) return { balance: 0, credited: {}, ownedPacks: {}, ownedItems: {} };
    return ensurePointsDoc(uid).then(function (ref) {
      return firestoreFns.getDoc(ref).then(function (snap) { return snap.data() || {}; });
    });
  });
}

/* Retourne une Promise résolue avec une fonction de désabonnement. */
export function watchPoints(uid, callback) {
  return ensureFirestore().then(function (ok) {
    if (!ok) return function () {};
    return ensurePointsDoc(uid).then(function (ref) {
      return firestoreFns.onSnapshot(ref, function (snap) { callback(snap.data() || {}); });
    });
  });
}

export function buyItem(itemId, price) {
  var user = currentUser();
  if (!user) return Promise.reject(new Error('not logged in'));
  return ensureFirestore().then(function () {
    var ref = firestoreFns.doc(db, 'points', user.uid);
    var update = {};
    update.balance = firestoreFns.increment(-price);
    update['ownedItems.' + itemId] = { purchasedAt: firestoreFns.serverTimestamp() };
    update.lastAction = { type: 'buy_item', key: itemId };
    return firestoreFns.updateDoc(ref, update);
  });
}

export function buyPack(packSlug, price) {
  var user = currentUser();
  if (!user) return Promise.reject(new Error('not logged in'));
  return ensureFirestore().then(function () {
    var instanceId = packSlug + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    var ref = firestoreFns.doc(db, 'points', user.uid);
    var update = {};
    update.balance = firestoreFns.increment(-price);
    update['ownedPacks.' + instanceId] = { packSlug: packSlug, purchasedAt: firestoreFns.serverTimestamp() };
    update.lastAction = { type: 'buy_pack', key: instanceId, packSlug: packSlug };
    return firestoreFns.updateDoc(ref, update).then(function () { return instanceId; });
  });
}

/* IDs des instances de pack déjà ouvertes (sous-collection openedPacks)
 * — sert à ne plus proposer "Ouvrir" pour un pack déjà révélé. */
export function loadOpenedPackIds(uid) {
  return ensureFirestore().then(function (ok) {
    if (!ok) return [];
    return firestoreFns.getDocs(firestoreFns.collection(db, 'points', uid, 'openedPacks')).then(function (snap) {
      var ids = [];
      snap.forEach(function (d) { ids.push(d.id); });
      return ids;
    }).catch(function () { return []; });
  });
}

export function openPack(instanceId, packSlug, grantedCards) {
  var user = currentUser();
  if (!user) return Promise.reject(new Error('not logged in'));
  return ensureFirestore().then(function () {
    var ref = firestoreFns.doc(db, 'points', user.uid, 'openedPacks', instanceId);
    return firestoreFns.setDoc(ref, {
      packSlug: packSlug,
      grantedCards: grantedCards,
      openedAt: firestoreFns.serverTimestamp(),
    });
  });
}

export function equip(slotType, itemId) {
  var user = currentUser();
  if (!user) return Promise.reject(new Error('not logged in'));
  return ensureFirestore().then(function () {
    var ref = firestoreFns.doc(db, 'points', user.uid);
    var update = {};
    update[slotType] = itemId;
    update.lastAction = { type: 'equip', key: itemId };
    return firestoreFns.updateDoc(ref, update);
  });
}
