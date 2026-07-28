/* Atlas Rising PLAY — HUD : synchronise la barre de navigation basse
 * avec les onglets déjà gérés par play-tabs.js (jamais modifié — on se
 * contente de déclencher un clic réel sur le bon .play-tab), et affiche
 * le niveau réel de l'utilisateur (calculé depuis son vrai solde Atlas
 * Points via points-config.js — jamais une valeur inventée). */

import { ensureFirestore, getFirestoreRefs, watchPoints } from './points.js';
import { getLevel } from './points-config.js';

(function () {
  var bottomNav = document.getElementById('play-bottom-nav');
  if (!bottomNav) return;

  /* ---------- Navigation basse -> mêmes onglets, aucune logique dupliquée ---------- */
  function setActive(tab) {
    document.querySelectorAll('.play-bottom-nav-item').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-goto') === tab);
    });
  }

  bottomNav.addEventListener('click', function (e) {
    var btn = e.target.closest('.play-bottom-nav-item');
    if (!btn) return;
    var tab = btn.getAttribute('data-goto');
    var tabBtn = document.querySelector('.play-tab[data-tab="' + tab + '"]');
    if (tabBtn) tabBtn.click();
    setActive(tab);

    if (btn.hasAttribute('data-scroll-top')) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    var scrollTarget = btn.getAttribute('data-scroll-target');
    if (scrollTarget) {
      setTimeout(function () {
        var el = document.getElementById(scrollTarget);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  });

  document.querySelectorAll('.play-tab').forEach(function (tabBtn) {
    tabBtn.addEventListener('click', function () {
      setActive(tabBtn.getAttribute('data-tab'));
    });
  });

  var initialTab = new URLSearchParams(window.location.search).get('tab') || 'quiz-solo';
  setActive(initialTab);

  /* ---------- Niveau réel dans le HUD (compte) ---------- */
  var levelEl = document.getElementById('play-hud-level');
  if (!levelEl) return;
  var unsubscribe = null;

  document.addEventListener('atlas-auth-changed', function (e) {
    var user = e.detail && e.detail.user;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (!user) { levelEl.hidden = true; return; }
    ensureFirestore().then(function (ok) {
      if (!ok) return;
      watchPoints(user.uid, function (data) {
        var level = getLevel((data && data.balance) || 0);
        levelEl.textContent = level.current.name;
        levelEl.hidden = false;
      }).then(function (unsub) { unsubscribe = unsub; });
    });
  });
})();
