/* pwa-install.js — petit bouton "Installer" avec les bulles flottantes.
   Deux comportements selon le navigateur, un seul bouton :
   - Chrome/Edge/Android (supportent beforeinstallprompt) : le clic
     déclenche l'invite native d'installation.
   - iOS Safari (aucune API d'installation programmable) : le clic
     affiche une petite bulle avec l'instruction manuelle
     (Partager -> Sur l'écran d'accueil).
   Le bouton ne s'affiche que sur mobile (retour utilisateur : inutile
   sur desktop), et reste caché si l'app tourne déjà en standalone
   (déjà installée) — vérifié à la fois au chargement et en continu via
   matchMedia (le passage en standalone peut arriver sans rechargement
   complet de la page juste après l'installation). */

(function () {
  const btn = document.getElementById('pwa-install-btn');
  if (!btn) return;

  const isMobile = /android|iphone|ipad|ipod/i.test(window.navigator.userAgent);
  if (!isMobile) return;

  const standaloneQuery = window.matchMedia(
    '(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)'
  );
  const isInstalled = () => standaloneQuery.matches || window.navigator.standalone === true;

  if (isInstalled()) return;

  standaloneQuery.addEventListener('change', () => {
    if (isInstalled()) {
      btn.hidden = true;
      const tip = document.getElementById('pwa-ios-tip');
      if (tip) tip.hidden = true;
    }
  });

  const isIOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  let deferredPrompt = null;

  if (isIOS) {
    btn.hidden = false;
    const tip = document.getElementById('pwa-ios-tip');
    const closeBtn = document.getElementById('pwa-ios-tip-close');
    btn.addEventListener('click', () => {
      if (tip) tip.hidden = !tip.hidden;
    });
    if (closeBtn && tip) {
      closeBtn.addEventListener('click', () => { tip.hidden = true; });
    }
    return;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    if (isInstalled()) return;
    event.preventDefault();
    deferredPrompt = event;
    btn.hidden = false;
  });

  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.hidden = true;
  });

  window.addEventListener('appinstalled', () => {
    btn.hidden = true;
    deferredPrompt = null;
  });
})();
