/* service-worker.js — généré par generator.py, ne pas éditer à la main
   ailleurs que dans templates/service-worker.js.

   Stratégie volontairement simple pour un site d'actu (le contenu
   change en continu via les agents) :
   - Pages (navigations) : network-first — jamais de contenu périmé
     tant qu'il y a du réseau, juste un filet de sécurité hors-ligne.
   - Assets statiques same-origin (css/js/img) : cache-first — déjà
     versionnés via ?v=1a7ba1fb74, donc un nouveau déploiement
     produit naturellement de nouvelles URLs, aucun risque de servir du
     vieux CSS/JS.
   - Tout le reste (Firebase, cross-origin, non-GET) : jamais intercepté,
     passe directement au réseau — ne doit jamais interférer avec
     l'auth ou les duels en temps réel. */

const CACHE_NAME = 'atlas-rising-1a7ba1fb74';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith('atlas-rising-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        await cache.put(req, res.clone());
        return res;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw err;
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/static/')) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(req, res.clone());
      }
      return res;
    })());
  }
});