/* Atlas Rising PLAY — couche transverse "tout répond". Se greffe par
 * délégation d'événements et MutationObserver sur des éléments déjà
 * rendus par les scripts existants (quiz.js, shop.js, pack-opening.js,
 * collection.js, dream-team.js, points-daily.js) — aucun de ces
 * fichiers n'est modifié. */

(function () {
  var root = document.querySelector('.play-tabs');
  if (!root) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Pression/rebond sur tout élément d'action ---------- */
  var PRESSABLE = '.quiz-btn-primary, .shop-buy-btn, .play-tab, .dreamteam-slot, ' +
    '.quizx-category-card, .quiz-duel-mode-tab, .filter-tab, .quiz-rank-play, ' +
    '.quiz-answer, .admin-cancel-btn';

  function press(e) {
    var el = e.target.closest(PRESSABLE);
    if (el) el.classList.add('play-pressed');
  }
  function release() {
    var pressed = document.querySelectorAll('.play-pressed');
    pressed.forEach(function (el) { el.classList.remove('play-pressed'); });
  }
  document.addEventListener('pointerdown', press);
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  document.addEventListener('pointerleave', release, true);

  if (reduceMotion) return; // le retour de pression (déjà quasi-instantané) reste utile,
  // mais on s'arrête là : pas de roulement de compteur ni d'effets en boucle.

  /* ---------- Compteurs qui roulent au lieu de sauter ---------- */
  function animateRoll(el, fromVal, toVal, duration) {
    var start = performance.now();
    function tick(now) {
      var t = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - t, 3);
      var current = Math.round(fromVal + (toVal - fromVal) * eased);
      el.textContent = current;
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        el.textContent = toVal;
        el.classList.remove('play-counter-rolling');
        watchCounter(el);
      }
    }
    requestAnimationFrame(tick);
  }

  var watchers = {};

  function watchCounter(el) {
    if (!el || !el.isConnected) return;
    if (watchers[el.id]) watchers[el.id].disconnect();
    var obs = new MutationObserver(function () { onCounterChange(el); });
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    watchers[el.id] = obs;
  }

  function onCounterChange(el) {
    var newVal = parseInt((el.textContent || '').replace(/[^\d-]/g, ''), 10);
    var oldVal = parseInt(el.dataset.playLastValue, 10);
    if (isNaN(newVal)) return;
    if (isNaN(oldVal) || oldVal === newVal) {
      el.dataset.playLastValue = String(newVal);
      return;
    }
    el.dataset.playLastValue = String(newVal);
    if (watchers[el.id]) watchers[el.id].disconnect();
    el.classList.add('play-counter-rolling');
    animateRoll(el, oldVal, newVal, 320);
  }

  function initCounter(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var v = parseInt((el.textContent || '').replace(/[^\d-]/g, ''), 10);
    el.dataset.playLastValue = String(isNaN(v) ? 0 : v);
    watchCounter(el);
  }

  ['points-badge-value', 'shop-balance-value'].forEach(initCounter);

  // Les onglets Boutique/Collection/Dream Team se (re)rendent après un
  // changement d'onglet ou une connexion différée — les compteurs
  // correspondants peuvent apparaître après le chargement initial.
  var lateInit = setInterval(function () {
    ['points-badge-value', 'shop-balance-value'].forEach(function (id) {
      if (!watchers[id] && document.getElementById(id)) initCounter(id);
    });
  }, 1500);
  window.addEventListener('beforeunload', function () { clearInterval(lateInit); });
})();
