/* pwa-install.js — petit bouton "Installer" dans le header.
   Deux comportements selon le navigateur, un seul bouton :
   - Chrome/Edge/Android (supportent beforeinstallprompt) : le clic
     déclenche l'invite native d'installation.
   - iOS Safari (aucune API d'installation programmable) : le clic
     affiche une petite bulle avec l'instruction manuelle
     (Partager -> Sur l'écran d'accueil).
   Le bouton reste caché si l'app tourne déjà en standalone (déjà
   installée) ou si le navigateur ne supporte ni l'un ni l'autre. */

(function () {
  const btn = document.getElementById('pwa-install-btn');
  if (!btn) return;

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isStandalone) return;

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
