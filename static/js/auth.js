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

let currentUser = null;
let authReady = false;

function dispatchAuthChanged() {
  document.dispatchEvent(new CustomEvent('atlas-auth-changed', { detail: { user: currentUser, ready: authReady } }));
}

// Promesse résolue une fois Firebase Auth initialisé (SDK chargé + instance
// prête). signUp/signIn/signOutUser l'attendent TOUJOURS avant d'agir, même
// si appelés très tôt (ex. soumission du formulaire avant la fin du
// chargement réseau du SDK) — évite la course "window.AtlasAuth.signUp is
// not a function" constatée le 26/07/2026 quand le clic précédait la fin de
// initFirebase().
let readyResolve;
const authReadyPromise = new Promise((resolve) => { readyResolve = resolve; });

window.AtlasAuth = {
  getCurrentUser: () => currentUser,
  isReady: () => authReady,
  isConfigured: () => firebaseConfigured,
  signUp: (email, password) => authReadyPromise.then((fns) => fns.createUserWithEmailAndPassword(fns.auth, email, password)),
  signIn: (email, password) => authReadyPromise.then((fns) => fns.signInWithEmailAndPassword(fns.auth, email, password)),
  signInWithGoogle: () => authReadyPromise.then((fns) => fns.signInWithPopup(fns.auth, fns.googleProvider)),
  signOutUser: () => authReadyPromise.then((fns) => fns.signOut(fns.auth)),
};

async function initFirebase() {
  const app = await firebaseAppPromise;
  const {
    getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
    signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, signOut,
  } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js');

  const auth = getAuth(app);
  const googleProvider = new GoogleAuthProvider();
  readyResolve({ auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, googleProvider, signOut });

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
  const icon = document.getElementById('account-icon');
  const avatar = document.getElementById('account-avatar');
  const loggedOutView = document.getElementById('account-logged-out');
  const loggedInView = document.getElementById('account-logged-in');
  const emailDisplay = document.getElementById('account-email-display');

  if (!label) return;

  if (!firebaseConfigured) {
    label.textContent = 'Compte';
    return;
  }

  if (currentUser) {
    // Bouton compte : photo de profil (Google) ou avatar à initiales
    // plutôt que l'email en clair dans le header, une fois connecté.
    if (icon) icon.hidden = true;
    label.hidden = true;
    if (avatar) {
      avatar.hidden = false;
      if (currentUser.photoURL) {
        avatar.innerHTML = '<img src="' + currentUser.photoURL + '" alt="">';
      } else {
        const name = currentUser.displayName || (currentUser.email || 'U').split('@')[0];
        avatar.textContent = name.charAt(0).toUpperCase();
      }
    }
    if (loggedOutView) loggedOutView.hidden = true;
    if (loggedInView) loggedInView.hidden = false;
    if (emailDisplay) emailDisplay.textContent = currentUser.email;
  } else {
    if (icon) icon.hidden = false;
    label.hidden = false;
    if (avatar) { avatar.hidden = true; avatar.innerHTML = ''; }
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

const SILENT_ERROR_CODES = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'];

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
  const googleBtn = document.getElementById('google-signin-btn');

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

  if (googleBtn) {
    googleBtn.addEventListener('click', function () {
      googleBtn.disabled = true;
      window.AtlasAuth.signInWithGoogle()
        .then(function () { closeOverlay(); })
        .catch(function (err) {
          if (SILENT_ERROR_CODES.indexOf(err.code) === -1) {
            showFormError(loginForm.hidden ? signupForm : loginForm, friendlyError(err));
          }
        })
        .finally(function () { googleBtn.disabled = false; });
    });
  }
});
