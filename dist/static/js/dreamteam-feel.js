/* Atlas Rising — Dream Team : décor discret (poussière/fumée dorée sur
 * le terrain, confettis rouge/or). Purement décoratif, scoppé à
 * #dreamteam-page — jamais lié à play-atmosphere.js/play-feel.js
 * (fichier séparé, comme prévu, pour ne rien risquer sur les autres
 * onglets Play). Coupé net sous prefers-reduced-motion. */

(function () {
  var page = document.getElementById('dreamteam-page');
  if (!page) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Confettis rouge/or (complétion d'équipe, partage) ---------- */
  function spawnConfetti(originEl) {
    if (!originEl) return;
    var rect = originEl.getBoundingClientRect();
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    var colors = ['#C1121F', '#B8903E', '#F2EBDC'];
    for (var i = 0; i < 22; i++) {
      var p = document.createElement('span');
      var angle = Math.random() * Math.PI * 2;
      var dist = 50 + Math.random() * 90;
      p.style.cssText = 'position:fixed;left:' + cx + 'px;top:' + cy + 'px;width:6px;height:6px;' +
        'background:' + colors[i % colors.length] + ';border-radius:2px;pointer-events:none;z-index:999;' +
        'transition:transform .8s cubic-bezier(.25,.46,.45,.94), opacity .8s ease;opacity:1;';
      document.body.appendChild(p);
      requestAnimationFrame(function (el, dx, dy) {
        return function () {
          el.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + (Math.random() * 360) + 'deg)';
          el.style.opacity = '0';
        };
      }(p, Math.cos(angle) * dist, Math.sin(angle) * dist - 40));
      setTimeout(function (el) { el.remove(); }, 850, p);
    }
  }

  function spawnGoldBurst(originEl) {
    if (!originEl) return;
    var rect = originEl.getBoundingClientRect();
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    for (var i = 0; i < 10; i++) {
      var p = document.createElement('span');
      var angle = Math.random() * Math.PI * 2;
      var dist = 20 + Math.random() * 34;
      p.style.cssText = 'position:fixed;left:' + cx + 'px;top:' + cy + 'px;width:4px;height:4px;' +
        'background:#EBCB84;border-radius:50%;pointer-events:none;z-index:999;box-shadow:0 0 4px rgba(235,203,132,.9);' +
        'transition:transform .5s cubic-bezier(.25,.46,.45,.94), opacity .5s ease;opacity:1;';
      document.body.appendChild(p);
      requestAnimationFrame(function (el, dx, dy) {
        return function () {
          el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
          el.style.opacity = '0';
        };
      }(p, Math.cos(angle) * dist, Math.sin(angle) * dist - 16));
      setTimeout(function (el) { el.remove(); }, 520, p);
    }
  }

  document.addEventListener('dreamteam-team-complete', function () {
    spawnConfetti(document.getElementById('dreamteam-pitch'));
  });
  document.addEventListener('dreamteam-coach-added', function () {
    spawnConfetti(document.getElementById('dreamteam-coach-card'));
  });
  document.addEventListener('dreamteam-card-added', function (e) {
    var slotId = e.detail && e.detail.slotId;
    var slotEl = slotId && document.querySelector('.dreamteam-slot[data-slot="' + slotId + '"]');
    if (slotEl) spawnGoldBurst(slotEl);
  });
  var shareBtn = document.getElementById('dreamteam-share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', function () { spawnConfetti(shareBtn); });
  }

  if (reduceMotion) return;

  /* ---------- Poussière/fumée légère confinée au terrain ---------- */
  var pitch = document.getElementById('dreamteam-pitch');
  if (!pitch) return;

  var sweep = document.createElement('div');
  sweep.className = 'dreamteam-pitch-sweep';
  pitch.appendChild(sweep);

  var canvas = document.createElement('canvas');
  canvas.id = 'dreamteam-particles-canvas';
  pitch.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  var w, h, dpr;

  function resize() {
    var rect = pitch.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = rect.width * dpr;
    h = canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
  }
  resize();
  window.addEventListener('resize', resize);

  var DUST_COUNT = window.matchMedia('(min-width:860px)').matches ? 26 : 16;
  var dust = [];
  for (var i = 0; i < DUST_COUNT; i++) {
    dust.push({
      x: Math.random(), y: Math.random(),
      r: .6 + Math.random() * 1.4,
      speed: 3 + Math.random() * 6,
      drift: (Math.random() - 0.5) * 4,
      alpha: .12 + Math.random() * .18,
    });
  }

  var last = performance.now();
  var paused = document.hidden;

  function step(now) {
    requestAnimationFrame(step);
    if (paused) { last = now; return; }
    var dt = Math.min((now - last) / 1000, .05);
    last = now;
    var rect = pitch.getBoundingClientRect();

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.scale(dpr, dpr);

    dust.forEach(function (d) {
      d.y -= (d.speed / Math.max(rect.height, 1)) * dt;
      d.x += (d.drift / Math.max(rect.width, 1)) * dt;
      if (d.y < -.02) { d.y = 1.02; d.x = Math.random(); }
      if (d.x < -.02) d.x = 1.02;
      if (d.x > 1.02) d.x = -.02;
      ctx.beginPath();
      ctx.fillStyle = 'rgba(216,190,140,' + d.alpha + ')';
      ctx.arc(d.x * rect.width, d.y * rect.height, d.r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }
  requestAnimationFrame(step);

  document.addEventListener('visibilitychange', function () { paused = document.hidden; });
})();
