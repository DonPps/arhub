/* Atlas Rising — crédite la connexion quotidienne (Atlas Points) dès
 * qu'un utilisateur connecté est détecté, sur n'importe quelle page, et
 * tient à jour le badge de solde du header. Séparé de auth.js pour ne
 * pas alourdir ce module central. */

import { handleDailyLogin, watchPoints } from './points.js';

var unsubscribe = null;

function updateBadge(data) {
  var badge = document.getElementById('points-badge');
  var value = document.getElementById('points-badge-value');
  if (!badge || !value) return;
  value.textContent = (data && data.balance) || 0;
  badge.hidden = false;
}

function hideBadge() {
  var badge = document.getElementById('points-badge');
  if (badge) badge.hidden = true;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
}

document.addEventListener('atlas-auth-changed', function (e) {
  var user = e.detail && e.detail.user;
  if (!user) { hideBadge(); return; }
  handleDailyLogin();
  if (unsubscribe) unsubscribe();
  watchPoints(user.uid, updateBadge).then(function (unsub) { unsubscribe = unsub; });
});
