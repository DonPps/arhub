// functions/subscribe.js — Cloudflare Pages Function.
//
// Équivalent de netlify/functions/subscribe.js, réécrit pour la convention
// Cloudflare Pages Functions (export onRequestPost, env au lieu de
// process.env). Même rôle : proxy serveur pour l'inscription newsletter —
// la clé API Brevo ne doit jamais être exposée côté client, donc cet appel
// passe par ici plutôt que directement depuis le navigateur.
//
// Servi automatiquement par Cloudflare Pages à l'URL /subscribe (le nom du
// fichier sous functions/ devient la route). Variables BREVO_API_KEY /
// BREVO_LIST_ID redéfinies (clé régénérée) dans le dashboard Cloudflare
// Pages (Settings → Variables and secrets, environnement Production).

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost({ request, env }) {
  const apiKey = env.BREVO_API_KEY;
  const listId = Number(env.BREVO_LIST_ID);
  if (!apiKey || !listId) {
    return json({ error: 'Newsletter non configurée (variables Cloudflare manquantes)' }, 500);
  }

  let email;
  try {
    const body = await request.json();
    email = (body.email || '').trim().toLowerCase();
  } catch (e) {
    return json({ error: 'Requête invalide' }, 400);
  }

  if (!email || !EMAIL_REGEX.test(email)) {
    return json({ error: 'Email invalide' }, 400);
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        email: email,
        listIds: [listId],
        updateEnabled: true,
      }),
    });

    if (res.status === 201 || res.status === 204) {
      return json({ ok: true });
    }

    const data = await res.json().catch(() => ({}));

    // Contact déjà inscrit : succès du point de vue utilisateur.
    if (data.code === 'duplicate_parameter') {
      return json({ ok: true, already: true });
    }

    return json({ error: 'Échec Brevo', detail: data.message || data.code || 'inconnu' }, 502);
  } catch (e) {
    return json({ error: 'Erreur serveur' }, 500);
  }
}

export async function onRequestGet({ env }) {
  // Diagnostic temporaire (26/07/2026) — recheck apres correction du nom
  // des variables (espace de trop retire). N'expose aucune valeur, juste
  // la presence/forme des variables recues. A retirer une fois confirme.
  return json({
    envKeys: Object.keys(env),
    hasApiKey: typeof env.BREVO_API_KEY,
    apiKeyLength: env.BREVO_API_KEY ? env.BREVO_API_KEY.length : 0,
    hasListId: typeof env.BREVO_LIST_ID,
    listIdRaw: env.BREVO_LIST_ID === undefined ? 'undefined' : JSON.stringify(env.BREVO_LIST_ID),
  }, 200);
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
