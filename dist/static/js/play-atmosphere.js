/* Atlas Rising PLAY — atmosphère de stade (brouillard léger, particules
 * ambiantes, flicker de projecteurs). Purement décoratif, jamais lié à
 * la logique des onglets/scripts existants (quiz.js, shop.js,
 * pack-opening.js, collection.js, dream-team.js, play-tabs.js — aucun
 * n'est modifié). Coupé net sous prefers-reduced-motion : ne garde que
 * la coquille statique déjà posée en CSS pur (play-hub.css). */

(function () {
  var root = document.querySelector('.play-tabs');
  if (!root) return;

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Décor en couches (toujours posé, même en reduced-motion —
   * seul le déplacement de parallaxe est coupé plus bas) ---------- */
  var far = document.createElement('div');
  far.className = 'play-bg-layer play-bg-far';
  var lights = document.createElement('div');
  lights.className = 'play-bg-layer play-bg-lights';
  document.body.insertBefore(lights, document.body.firstChild);
  document.body.insertBefore(far, lights);

  var jumbotron = document.createElement('div');
  jumbotron.className = 'play-bg-jumbotron';
  var main = document.querySelector('.play-main');
  if (main) main.style.position = main.style.position || 'relative';
  (main || document.body).insertBefore(jumbotron, (main || document.body).firstChild);

  if (!reduceMotion) {
    var layers = [
      { el: far, depth: 6 },
      { el: lights, depth: 14 },
      { el: jumbotron, depth: 22 },
    ];
    var targetX = 0, targetY = 0, curX = 0, curY = 0;
    document.addEventListener('mousemove', function (e) {
      targetX = (e.clientX / window.innerWidth - 0.5) * 2;
      targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    });
    function parallaxTick() {
      requestAnimationFrame(parallaxTick);
      curX += (targetX - curX) * 0.06;
      curY += (targetY - curY) * 0.06;
      var scrollFactor = Math.min(window.scrollY / 600, 1);
      layers.forEach(function (l) {
        var dx = curX * l.depth;
        var dy = curY * l.depth * 0.6 - scrollFactor * l.depth * 1.4;
        l.el.style.transform = 'translate3d(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px,0)';
      });
    }
    parallaxTick();
  }

  if (reduceMotion) return;

  /* ---------- Flicker discret des projecteurs (GSAP) ---------- */
  var flicker = document.createElement('div');
  flicker.className = 'play-floodlight-flicker';
  flicker.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;' +
    'background:radial-gradient(60% 40% at 8% 0%, rgba(184,144,62,.10), transparent),' +
    'radial-gradient(60% 40% at 92% 0%, rgba(184,144,62,.10), transparent);';
  document.body.appendChild(flicker);

  import('https://cdn.jsdelivr.net/npm/gsap@3.12.5/+esm').then(function (mod) {
    var gsap = mod.gsap || mod.default;
    if (!gsap) return;
    var tl = gsap.timeline({ repeat: -1 });
    tl.to(flicker, { opacity: 0.55, duration: 2.6, ease: 'sine.inOut' })
      .to(flicker, { opacity: 1, duration: 1.8, ease: 'sine.inOut' })
      .to(flicker, { opacity: 0.85, duration: 0.12, ease: 'none' })
      .to(flicker, { opacity: 1, duration: 0.12, ease: 'none' })
      .to(flicker, { opacity: 1, duration: 3.2, ease: 'sine.inOut' });
  }).catch(function () { /* GSAP indisponible (offline, CDN bloqué) : la coquille statique CSS suffit. */ });

  /* ---------- Brouillard léger + particules ambiantes (Canvas) ---------- */
  var canvas = document.createElement('canvas');
  canvas.id = 'play-atmosphere-canvas';
  document.body.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  var w, h, dpr;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = window.innerWidth * dpr;
    h = canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
  }
  resize();
  window.addEventListener('resize', resize);

  var FOG_COUNT = 4;
  var EMBER_COUNT = 14;

  var fogs = [];
  for (var i = 0; i < FOG_COUNT; i++) {
    fogs.push({
      x: Math.random() * window.innerWidth,
      y: window.innerHeight * (0.55 + Math.random() * 0.4),
      r: 220 + Math.random() * 160,
      speed: 6 + Math.random() * 10,
      dir: Math.random() < 0.5 ? 1 : -1,
    });
  }

  var embers = [];
  for (var j = 0; j < EMBER_COUNT; j++) {
    embers.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      r: 1 + Math.random() * 1.8,
      speed: 6 + Math.random() * 14,
      drift: (Math.random() - 0.5) * 10,
      alpha: 0.15 + Math.random() * 0.25,
    });
  }

  var last = performance.now();
  var rafId = null;
  var paused = document.hidden;

  function step(now) {
    rafId = requestAnimationFrame(step);
    if (paused) { last = now; return; }
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.scale(dpr, dpr);

    fogs.forEach(function (f) {
      f.x += f.dir * f.speed * dt;
      if (f.x < -f.r) f.x = window.innerWidth + f.r;
      if (f.x > window.innerWidth + f.r) f.x = -f.r;
      var grad = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
      grad.addColorStop(0, 'rgba(242,235,220,.05)');
      grad.addColorStop(1, 'rgba(242,235,220,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      ctx.fill();
    });

    embers.forEach(function (e) {
      e.y -= e.speed * dt;
      e.x += e.drift * dt;
      if (e.y < -10) { e.y = window.innerHeight + 10; e.x = Math.random() * window.innerWidth; }
      ctx.beginPath();
      ctx.fillStyle = 'rgba(216,168,84,' + e.alpha + ')';
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }
  rafId = requestAnimationFrame(step);

  document.addEventListener('visibilitychange', function () {
    paused = document.hidden;
  });
})();
