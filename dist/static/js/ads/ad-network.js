// static/js/ads/ad-network.js
//
// Régies publicitaires "programmatiques" (Google AdSense aujourd'hui,
// une autre régie demain). Chaque régie expose un adaptateur avec une
// méthode render(container, adDoc, ctx) — c'est le seul point de
// couplage avec un réseau publicitaire externe.
//
// POUR REMPLACER ADSENSE PAR UNE AUTRE RÉGIE : ajouter un nouvel
// adaptateur ici (même forme : { render(container, adDoc, ctx) }),
// puis l'enregistrer dans NETWORK_ADAPTERS (ad-manager.js) sous la clé
// utilisée par le champ "type" des documents Firestore concernés.
// Aucun autre fichier (templates, moteur, règles Firestore) n'a besoin
// d'être modifié.

const DEV_HOSTNAMES = ['localhost', '127.0.0.1'];
const isDev = () => DEV_HOSTNAMES.includes(location.hostname);

let adsenseScriptPromise = null;
function loadAdsenseScript(client) {
  if (adsenseScriptPromise) return adsenseScriptPromise;
  adsenseScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    script.crossOrigin = 'anonymous';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return adsenseScriptPromise;
}

// adDoc attendu : { slot, format, responsive } (props demandées : slot,
// format, responsive, enabled — "enabled" est déjà filtré en amont par
// ad-manager.js, qui ne transmet ici que des pubs actives).
export const adsenseAdapter = {
  render(container, adDoc, { adsenseClient, adsenseConfigured }) {
    const hasConfig = adsenseConfigured && adDoc.slot;
    if (!hasConfig) {
      if (isDev()) {
        container.classList.add('ad-placeholder');
        container.textContent = 'AdSense — non configuré (visible en dev uniquement)';
      } else {
        container.classList.add('ad-empty');
      }
      return;
    }

    container.classList.add('ad-has-content');
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.style.width = '100%';
    ins.style.height = '100%';
    ins.setAttribute('data-ad-client', adsenseClient);
    ins.setAttribute('data-ad-slot', adDoc.slot);
    if (adDoc.format) ins.setAttribute('data-ad-format', adDoc.format);
    if (adDoc.responsive) ins.setAttribute('data-full-width-responsive', 'true');
    container.appendChild(ins);

    loadAdsenseScript(adsenseClient)
      .then(() => { (window.adsbygoogle = window.adsbygoogle || []).push({}); })
      .catch(() => { container.classList.remove('ad-has-content'); container.classList.add('ad-empty'); });
  },
};
