// static/js/auth.js — Authentification Firebase (email/mot de passe).
//
// Gère : le bouton "Compte" du header, la modale connexion/inscription,
// et expose l'état d'authentification au reste du site via :
//   - window.AtlasAuth.getCurrentUser()
//   - un événement DOM "atlas-auth-changed" (detail: { user }) déclenché
//     à chaque changement d'état (connecté / déconnecté / chargement initial)
//
// Tant que static/js/firebase-config.js contient encore les valeurs
// placeholder, tout ce module se met en veille proprement (bouton désactivé,
// message clair) plutôt que de planter — voir firebaseConfigured.

import { firebaseConfigured, firebaseAppPromise } from './firebase-config.js';

let auth = null;
let currentUser = null;
let authReady = false;

function dispatchAuthChanged() {
  document.dispatchEvent(new CustomEvent('atlas-auth-changed', { detail: { user: currentUser, ready: authReady } }));
}

window.AtlasAuth = {
  getCurrentUser: () => currentUser,
  isReady: () => authReady,
  isConfigured: () => firebaseConfigured,
};

async function initFirebase() {
  const app = await firebaseAppPromise;
  const {
    getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
    signInWithEmailAndPassword, signOut,
  } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js');

  auth = getAuth(app);

  window.AtlasAuth.signUp = (email, password) => createUserWithEmailAndPassword(auth, email, password);
  window.AtlasAuth.signIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
  window.AtlasAuth.signOutUser = () => signOut(auth);

  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    authReady = true;
    dispatchAuthChanged();
    renderAccountUI();
  });
}

/* ---------- UI : bouton compte + modale ---------- */

function renderAccountUI() {
  const label = document.getElementById('account-label');
  const loggedOutView = document.getElementById('account-logged-out');
  const loggedInView = document.getElementById('account-logged-in');
  const emailDisplay = document.getElementById('account-email-display');

  if (!label) return;

  if (!firebaseConfigured) {
    label.textContent = 'Compte';
    return;
  }

  if (currentUser) {
    label.textContent = currentUser.email;
    if (loggedOutView) loggedOutView.hidden = true;
    if (loggedInView) loggedInView.hidden = false;
    if (emailDisplay) emailDisplay.textContent = currentUser.email;
  } else {
    label.textContent = 'Compte';
    if (loggedOutView) loggedOutView.hidden = false;
    if (loggedInView) loggedInView.hidden = true;
  }
}

function showFormError(form, message) {
  const errorEl = form.querySelector('.account-error');
  if (!errorEl) return;
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearFormError(form) {
  const errorEl = form.querySelector('.account-error');
  if (errorEl) errorEl.hidden = true;
}

const FIREBASE_ERROR_MESSAGES = {
  'auth/invalid-email': 'Adresse email invalide.',
  'auth/user-not-found': 'Aucun compte avec cet email.',
  'auth/wrong-password': 'Mot de passe incorrect.',
  'auth/invalid-credential': 'Email ou mot de passe incorrect.',
  'auth/email-already-in-use': 'Un compte existe déjà avec cet email.',
  'auth/weak-password': 'Mot de passe trop court (6 caractères minimum).',
};

function friendlyError(err) {
  return FIREBASE_ERROR_MESSAGES[err.code] || 'Une erreur est survenue, réessaie.';
}

document.addEventListener('DOMContentLoaded', function () {
  const toggle = document.getElementById('account-toggle');
  const overlay = document.getElementById('account-overlay');
  const closeBtn = document.getElementById('account-close');
  const tabs = document.querySelectorAll('.account-tab');
  const loginForm = document.getElementById('login-form');
  const signupForm = document.getElementById('signup-form');
  const logoutBtn = document.getElementById('logout-btn');

  if (!toggle || !overlay) return;

  if (!firebaseConfigured) {
    toggle.addEventListener('click', function () {
      alert("La connexion n'est pas encore configurée sur ce site (bientôt disponible).");
    });
    return;
  }

  initFirebase();

  function openOverlay() {
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    toggle.setAttribute('aria-expanded', 'true');
  }
  function closeOverlay() {
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    toggle.setAttribute('aria-expanded', 'false');
  }

  toggle.addEventListener('click', openOverlay);
  if (closeBtn) closeBtn.addEventListener('click', closeOverlay);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeOverlay(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay.classList.contains('is-open')) closeOverlay();
  });

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      tabs.forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      const target = tab.getAttribute('data-tab');
      loginForm.hidden = target !== 'login';
      signupForm.hidden = target !== 'signup';
    });
  });

  if (loginForm) {
    loginForm.addEventListener('submit', function (e) {
      e.preventDefault();
      clearFormError(loginForm);
      const email = loginForm.querySelector('input[type="email"]').value.trim();
      const password = loginForm.querySelector('input[type="password"]').value;
      const button = loginForm.querySelector('button');
      button.disabled = true;
      window.AtlasAuth.signIn(email, password)
        .then(function () { closeOverlay(); loginForm.reset(); })
        .catch(function (err) { showFormError(loginForm, friendlyError(err)); })
        .finally(function () { button.disabled = false; });
    });
  }

  if (signupForm) {
    signupForm.addEventListener('submit', function (e) {
      e.preventDefault();
      clearFormError(signupForm);
      const email = signupForm.querySelector('input[type="email"]').value.trim();
      const password = signupForm.querySelector('input[type="password"]').value;
      const button = signupForm.querySelector('button');
      button.disabled = true;
      window.AtlasAuth.signUp(email, password)
        .then(function () { closeOverlay(); signupForm.reset(); })
        .catch(function (err) { showFormError(signupForm, friendlyError(err)); })
        .finally(function () { button.disabled = false; });
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      window.AtlasAuth.signOutUser().then(closeOverlay);
    });
  }
});
