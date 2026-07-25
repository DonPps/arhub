// static/js/firebase-config.js
//
// Configuration Firebase — à REMPLACER par les vraies valeurs de ton
// projet Firebase (console.firebase.google.com → Paramètres du projet →
// Général → "Vos applications" → application Web → objet de config).
//
// Ces valeurs ne sont PAS secrètes (contrairement à une clé API Brevo) :
// le modèle de sécurité Firebase repose sur les règles Firestore
// (firestore.rules), pas sur le fait de cacher cette config. Elle peut
// rester en clair dans ce fichier JS public sans risque.

export const firebaseConfig = {
  apiKey: "REMPLACER_API_KEY",
  authDomain: "REMPLACER.firebaseapp.com",
  projectId: "REMPLACER_PROJECT_ID",
  storageBucket: "REMPLACER.appspot.com",
  messagingSenderId: "REMPLACER_SENDER_ID",
  appId: "REMPLACER_APP_ID",
};

// true tant que la config ci-dessus contient les valeurs par défaut —
// permet au reste du code de désactiver proprement les fonctionnalités
// de compte (au lieu de planter) tant que le vrai projet Firebase n'est
// pas branché.
export const firebaseConfigured = firebaseConfig.apiKey !== "REMPLACER_API_KEY";

// Instance Firebase partagée (une seule initialisation) — auth.js et
// quiz.js importent cette même promesse plutôt que d'appeler
// initializeApp() chacun de leur côté.
export const firebaseAppPromise = firebaseConfigured
  ? import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js')
      .then(({ initializeApp }) => initializeApp(firebaseConfig))
  : Promise.resolve(null);
