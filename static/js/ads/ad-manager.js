// static/js/ads/ad-manager.js — moteur central des emplacements publicitaires.
//
// Fonctionnement :
//   1. Repère tous les conteneurs [data-ad-placement] présents dans le
//      DOM (générés par les macros Jinja2 de templates/_ads.html — un
//      "composant" par type : leaderboard, sidebar, inline, bottom,
//      sponsor-hero, sponsor-match, sponsor-sidebar).
//   2. Charge UNE SEULE FOIS la collection Firestore "ads" (lecture
//      publique, cf. firestore.rules) et la garde en mémoire pour toute
//      la page.
//   3. Observe l'entrée de chaque conteneur dans le viewport
//      (IntersectionObserver, marge de 200px) — rien n'est jamais
//      chargé ni rendu hors écran.
//   4. À l'entrée dans le viewport : sélectionne la meilleure pub pour
//      ce placement (selectAdForPlacement — pure, testable sans DOM ni
//      Firestore), puis délègue le rendu à l'adaptateur de régie
//      (ad-network.js) si type="adsense", ou au rendu sponsor local
//      sinon. Si aucune pub ne correspond, le conteneur disparaît
//      proprement (classe .ad-empty) — jamais de case vide permanente.
//   5. Incrémente un compteur Firestore (impressions à l'affichage,
//      clics au clic sur la carte) — best-effort, jamais bloquant pour
//      l'utilisateur.
//
// AJOUTER UN NOUVEL EMPLACEMENT (aucune modification JS nécessaire) :
//   1. Choisir un identifiant de placement, ex. "article_inline_p2".
//   2. Dans le template Jinja2 concerné :
//        {% from "_ads.html" import ad_inline %}
//        {{ ad_inline('article_inline_p2') }}
//   3. Créer un document dans la collection Firestore "ads" avec ce
//      même "placement" (console Firebase en attendant l'admin
//      /admin/ads). Le site le prend en compte sans redéploiement.
//
// CHANGER DE RÉGIE PUBLICITAIRE : voir l'en-tête de ad-network.js.

import { firebaseConfigured, firebaseAppPromise } from '../firebase-config.js';
import { adsenseAdapter } from './ad-network.js';

// Publisher AdSense du site — à remplacer une fois le compte approuvé
// (même valeur que le <script> commenté dans base.html). Tant que la
// valeur reste celle-ci, l'adaptateur AdSense se met en veille
// (placeholder en dev, rien en prod) plutôt que d'appeler une régie
// non configurée.
const ADSENSE_CLIENT = 'ca-pub-7966410012892502';
const ADSENSE_CONFIGURED = ADSENSE_CLIENT !== 'ca-pub-REMPLACER';

const NETWORK_ADAPTERS = {
  adsense: adsenseAdapter,
};

let db = null;
let firestoreFns = null;
let adsPromise = null;

function initFirestore() {
  if (!firebaseConfigured) return Promise.resolve(false);
  return firebaseAppPromise.then((app) =>
    import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js').then((mod) => {
      db = mod.initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
      firestoreFns = mod;
      return true;
    })
  );
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => { setTimeout(() => resolve(fallback), ms); }),
  ]);
}

function loadAllAds() {
  if (adsPromise) return adsPromise;
  adsPromise = initFirestore()
    .then((ready) => {
      if (!ready) return [];
      const ref = firestoreFns.collection(db, 'ads');
      return withTimeout(
        firestoreFns.getDocs(ref).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        8000,
        []
      );
    })
    .catch(() => []);
  return adsPromise;
}

function isWithinDateRange(ad, now) {
  if (ad.startDate && now < new Date(ad.startDate)) return false;
  if (ad.endDate) {
    const end = new Date(ad.endDate);
    end.setHours(23, 59, 59, 999);
    if (now > end) return false;
  }
  return true;
}

// Pure et testable indépendamment du DOM/Firestore : parmi les pubs
// actives pour ce placement (enabled + dans la fenêtre de dates), garde
// celle de plus haute priorité. Exportée pour être testée isolément.
export function selectAdForPlacement(ads, placement, now = new Date()) {
  const candidates = ads.filter(
    (ad) => ad.placement === placement && ad.enabled !== false && isWithinDateRange(ad, now)
  );
  if (!candidates.length) return null;
  return candidates.reduce((best, ad) => ((ad.priority || 0) > (best.priority || 0) ? ad : best));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function trackEvent(adId, field) {
  if (!adId || !db || !firestoreFns) return;
  const ref = firestoreFns.doc(db, 'ads', adId);
  firestoreFns.updateDoc(ref, { [field]: firestoreFns.increment(1) }).catch(() => {});
}

function renderSponsor(container, ad) {
  container.classList.add('ad-has-content');

  const link = document.createElement('a');
  link.className = 'sponsor-card-link';
  link.href = ad.url || '#';
  link.target = '_blank';
  link.rel = 'noopener sponsored';

  let html = '<span class="sponsor-tag">Sponsorisé</span>';
  if (ad.image) html += `<img class="sponsor-image" src="${ad.image}" alt="" loading="lazy">`;
  html += '<span class="sponsor-body">';
  if (ad.logo) html += `<img class="sponsor-logo" src="${ad.logo}" alt="" loading="lazy">`;
  if (ad.title) html += `<span class="sponsor-title">${escapeHtml(ad.title)}</span>`;
  if (ad.description) html += `<span class="sponsor-desc">${escapeHtml(ad.description)}</span>`;
  if (ad.button) html += `<span class="sponsor-btn">${escapeHtml(ad.button)}</span>`;
  html += '</span>';
  link.innerHTML = html;

  link.addEventListener('click', () => trackEvent(ad.id, 'clicks'), { once: true });
  container.appendChild(link);
}

function renderPlacement(container, ads) {
  const placement = container.getAttribute('data-ad-placement');
  const ad = selectAdForPlacement(ads, placement);

  if (!ad) {
    container.classList.add('ad-empty');
    return;
  }

  if (ad.type === 'adsense') {
    NETWORK_ADAPTERS.adsense.render(container, ad, {
      adsenseClient: ADSENSE_CLIENT,
      adsenseConfigured: ADSENSE_CONFIGURED,
    });
  } else {
    renderSponsor(container, ad);
  }

  trackEvent(ad.id, 'impressions');
}

function initPlacements() {
  const containers = document.querySelectorAll('[data-ad-placement]');
  if (!containers.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        loadAllAds().then((ads) => renderPlacement(entry.target, ads));
      });
    },
    { rootMargin: '200px 0px' }
  );

  containers.forEach((el) => observer.observe(el));
}

document.addEventListener('DOMContentLoaded', initPlacements);
