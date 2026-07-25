// netlify/functions/subscribe.js
//
// Proxy serveur pour l'inscription newsletter. La clé API Brevo ne doit
// jamais être exposée côté client (site statique, code visible de tous) —
// cette fonction tourne côté Netlify et lit BREVO_API_KEY / BREVO_LIST_ID
// depuis les variables d'environnement du site (jamais commitées).

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const apiKey = process.env.BREVO_API_KEY;
  const listId = Number(process.env.BREVO_LIST_ID);
  if (!apiKey || !listId) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Newsletter non configurée (variables Netlify manquantes)' }) };
  }

  let email;
  try {
    const body = JSON.parse(event.body || '{}');
    email = (body.email || '').trim().toLowerCase();
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Requête invalide' }) };
  }

  if (!email || !EMAIL_REGEX.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email invalide' }) };
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
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    const data = await res.json().catch(() => ({}));

    // Contact déjà inscrit : on considère ça comme un succès du point de vue utilisateur.
    if (data.code === 'duplicate_parameter') {
      return { statusCode: 200, body: JSON.stringify({ ok: true, already: true }) };
    }

    return { statusCode: 502, body: JSON.stringify({ error: 'Échec Brevo', detail: data.message || data.code || 'inconnu' }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Erreur serveur' }) };
  }
};
