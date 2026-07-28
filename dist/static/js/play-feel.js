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

  /* ---------- Tilt 3D au survol des panneaux (--tilt-x/--tilt-y lus par
   * play-hub.css) — même liste de sélecteurs que le système de panneaux. ---------- */
  var TILTABLE = '.shop-card, .quiz-rank-card, .quizx-stat-card, .quizx-featured, ' +
    '.dreamteam-picker-card, .pack-reveal-card, .quizx-sidebar-card';
  var tiltedEl = null;

  document.addEventListener('pointermove', function (e) {
    var el = e.target.closest(TILTABLE);
    if (el !== tiltedEl) {
      if (tiltedEl) resetTilt(tiltedEl);
      tiltedEl = el;
    }
    if (!el) return;
    var rect = el.getBoundingClientRect();
    var px = (e.clientX - rect.left) / rect.width - 0.5;
    var py = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty('--tilt-y', (px * 8).toFixed(2) + 'deg');
    el.style.setProperty('--tilt-x', (-py * 8).toFixed(2) + 'deg');
  });
  function resetTilt(el) {
    el.style.setProperty('--tilt-x', '0deg');
    el.style.setProperty('--tilt-y', '0deg');
  }
  document.addEventListener('pointerleave', function () {
    if (tiltedEl) { resetTilt(tiltedEl); tiltedEl = null; }
  }, true);

  /* ---------- Confettis légers sur gain (pas sur dépense) ---------- */
  function spawnConfetti(originEl) {
    var rect = originEl.getBoundingClientRect();
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    var colors = ['#C1121F', '#B8903E', '#F2EBDC'];
    for (var i = 0; i < 16; i++) {
      var p = document.createElement('span');
      var angle = Math.random() * Math.PI * 2;
      var dist = 40 + Math.random() * 70;
      p.style.cssText = 'position:fixed;left:' + cx + 'px;top:' + cy + 'px;width:6px;height:6px;' +
        'background:' + colors[i % colors.length] + ';border-radius:2px;pointer-events:none;z-index:999;' +
        'transition:transform .7s cubic-bezier(.25,.46,.45,.94), opacity .7s ease;opacity:1;';
      document.body.appendChild(p);
      requestAnimationFrame(function (el, dx, dy) {
        return function () {
          el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (Math.random() * 360) + 'deg)';
          el.style.opacity = '0';
        };
      }(p, Math.cos(angle) * dist, Math.sin(angle) * dist - 30));
      setTimeout(function (el) { el.remove(); }, 750, p);
    }
  }

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
    if (newVal > oldVal) spawnConfetti(el);
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

  /* ---------- Confettis quand une carte haute rareté sort d'un pack ----------
   * Observe le contenu déjà rendu par pack-opening.js (jamais modifié) :
   * dès qu'une carte .rarity-legendary/.rarity-mythic/.rarity-limited-
   * edition/.rarity-event-exclusive apparaît, un burst se déclenche une
   * seule fois par ouverture. */
  var packBody = document.getElementById('pack-opening-body');
  if (packBody) {
    var celebratedThisOpen = false;
    var packObserver = new MutationObserver(function () {
      if (celebratedThisOpen) return;
      var rare = packBody.querySelector('.rarity-legendary, .rarity-mythic, .rarity-limited-edition, .rarity-event-exclusive');
      if (rare) {
        celebratedThisOpen = true;
        spawnConfetti(packBody.closest('.pack-opening-panel') || packBody);
      }
    });
    packObserver.observe(packBody, { childList: true, subtree: true });
    document.addEventListener('click', function (e) {
      if (e.target.closest('.shop-open-btn')) celebratedThisOpen = false;
    });
  }
})();
