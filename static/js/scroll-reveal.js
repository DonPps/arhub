/* Atlas Rising — révélation légère au scroll (IntersectionObserver, sans
 * dépendance). Ajoute .is-visible aux éléments marqués [data-reveal]
 * quand ils entrent dans le viewport ; le fondu/translateY est purement
 * CSS (voir style.css). Respecte prefers-reduced-motion et ne réobserve
 * jamais un élément déjà révélé (pas de rejeu en scrollant). */

document.addEventListener('DOMContentLoaded', function () {
  var targets = document.querySelectorAll('[data-reveal]');
  if (!targets.length) return;

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    targets.forEach(function (el) { el.classList.add('is-visible'); });
    return;
  }

  if (!('IntersectionObserver' in window)) {
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
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  targets.forEach(function (el) { observer.observe(el); });
});
