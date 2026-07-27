/* Atlas Rising — carrousel horizontal générique (boutons précédent/
 * suivant). Le scroll tactile natif + scroll-snap-x gèrent déjà le swipe
 * mobile ; ce script ne fait que déplacer le scroll d'une "carte" par
 * clic sur les flèches. Réutilisable pour toute future section en
 * .hcarousel (vidéos, podcasts...). */

document.addEventListener('DOMContentLoaded', function () {
  var carousels = document.querySelectorAll('[data-hcarousel]');

  carousels.forEach(function (carousel) {
    var track = carousel.querySelector('.hcarousel-track');
    var prevBtn = carousel.querySelector('.hcarousel-prev');
    var nextBtn = carousel.querySelector('.hcarousel-next');
    if (!track) return;

    function cardWidth() {
      var card = track.querySelector('.hcarousel-card');
      if (!card) return track.clientWidth;
      var style = window.getComputedStyle(track);
      var gap = parseFloat(style.columnGap || style.gap || '0') || 0;
      return card.getBoundingClientRect().width + gap;
    }

    if (prevBtn) prevBtn.addEventListener('click', function () {
      track.scrollBy({ left: -cardWidth(), behavior: 'smooth' });
    });
    if (nextBtn) nextBtn.addEventListener('click', function () {
      track.scrollBy({ left: cardWidth(), behavior: 'smooth' });
    });
  });
});
