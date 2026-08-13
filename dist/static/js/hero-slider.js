/* Atlas Rising — hero slider de la home (autoplay + flèches + points +
 * swipe tactile). Vanilla JS, sans dépendance. Chaque slide est un
 * .hero-slide affiché/masqué via display (pas d'empilement absolu) pour
 * que la hauteur du composant suive naturellement le contenu de la
 * slide active, quelle que soit la longueur du titre. */

document.addEventListener('DOMContentLoaded', function () {
  var root = document.getElementById('hero-slider');
  if (!root) return;

  var slides = Array.prototype.slice.call(root.querySelectorAll('.hero-slide'));
  if (slides.length < 2) return; // rien à faire pour une seule slide (pas de flèches/points rendus)

  var dots = Array.prototype.slice.call(root.querySelectorAll('.hero-slider-dot'));
  var prevBtn = root.querySelector('.hero-slider-prev');
  var nextBtn = root.querySelector('.hero-slider-next');
  var interval = parseInt(root.getAttribute('data-autoplay'), 10) || 6000;
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var current = 0;
  var timer = null;

  function show(index) {
    current = (index + slides.length) % slides.length;
    slides.forEach(function (s, i) { s.classList.toggle('is-active', i === current); });
    dots.forEach(function (d, i) { d.classList.toggle('is-active', i === current); });
  }

  function next() { show(current + 1); }
  function prev() { show(current - 1); }

  function startAutoplay() {
    if (reducedMotion) return;
    stopAutoplay();
    timer = setInterval(next, interval);
  }
  function stopAutoplay() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  if (prevBtn) prevBtn.addEventListener('click', function () { prev(); startAutoplay(); });
  if (nextBtn) nextBtn.addEventListener('click', function () { next(); startAutoplay(); });
  dots.forEach(function (dot, i) {
    dot.addEventListener('click', function () { show(i); startAutoplay(); });
  });

  root.addEventListener('mouseenter', stopAutoplay);
  root.addEventListener('mouseleave', startAutoplay);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopAutoplay(); else startAutoplay();
  });

  // Swipe tactile (mobile)
  var touchStartX = null;
  root.addEventListener('touchstart', function (e) {
    touchStartX = e.touches[0].clientX;
    stopAutoplay();
  }, { passive: true });
  root.addEventListener('touchend', function (e) {
    if (touchStartX === null) return;
    var delta = e.changedTouches[0].clientX - touchStartX;
    if (Math.abs(delta) > 40) { delta < 0 ? next() : prev(); }
    touchStartX = null;
    startAutoplay();
  });

  startAutoplay();
});
