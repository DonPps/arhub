/* Atlas Rising — bulles flottantes (podcast + quiz), présentes sur toutes
 * les pages via base.html. Le bouton podcast ouvre/ferme une petite
 * pop-up avec le lecteur (façon bulle WhatsApp) ; le bouton quiz est un
 * simple lien direct. */

document.addEventListener('DOMContentLoaded', function () {
  var toggle = document.getElementById('podcast-bubble-toggle');
  var popup = document.getElementById('podcast-popup');
  var closeBtn = document.getElementById('podcast-popup-close');
  if (!toggle || !popup) return;

  function openPopup() {
    popup.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  }
  function closePopup() {
    popup.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', function () {
    if (popup.hidden) openPopup(); else closePopup();
  });
  if (closeBtn) closeBtn.addEventListener('click', closePopup);

  document.addEventListener('click', function (e) {
    if (popup.hidden) return;
    if (popup.contains(e.target) || toggle.contains(e.target)) return;
    closePopup();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !popup.hidden) closePopup();
  });
});
