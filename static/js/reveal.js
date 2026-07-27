/* Atlas Rising — révélation légère au scroll (home uniquement). Ajoute
 * .is-visible aux éléments [data-reveal] quand ils entrent dans le
 * viewport ; le fondu/translateY est en CSS. Respecte
 * prefers-reduced-motion et ne réobserve jamais un élément déjà révélé. */

document.addEventListener('DOMContentLoaded', function () {
  var targets = document.querySelectorAll('[data-reveal]');
  if (!targets.length) return;

  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion || !('IntersectionObserver' in window)) {
    targets.forEach(function (el) { el.classList.add('is-visible'); });
    return;
  }

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });

  targets.forEach(function (el) { observer.observe(el); });
});
