/* Atlas Rising — page profil (compte + progression Atlas Quiz, lecture seule) */

import { firebaseConfigured, firebaseAppPromise } from './firebase-config.js';

(function () {

  var page = document.getElementById('profile-page');
  if (!page) return;

  var gateScreen = document.getElementById('profile-login-gate');
  var contentScreen = document.getElementById('profile-content');
  var db = null;
  var firestoreFns = null;

  function initFirestore() {
    if (!firebaseConfigured) return Promise.resolve(false);
    return firebaseAppPromise.then(function (app) {
      return import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js').then(function (mod) {
        db = mod.initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
        firestoreFns = mod;
        return true;
      });
    });
  }

  function withTimeout(promise, ms, fallback) {
    return Promise.race([
      promise,
      new Promise(function (resolve) { setTimeout(function () { resolve(fallback); }, ms); }),
    ]);
  }

  function loadProgress(uid) {
    var ref = firestoreFns.doc(db, 'quizProgress', uid);
    return withTimeout(
      firestoreFns.getDoc(ref).then(function (snap) {
        return snap.exists() ? snap.data() : {};
      }).catch(function () {
        return {};
      }),
      8000,
      {}
    );
  }

  function getRankRows() {
    return Array.prototype.slice.call(document.querySelectorAll('.profile-rank-row'));
  }

  function renderBadges(rows, progress) {
    var badgesEl = document.getElementById('profile-badges');
    if (!badgesEl) return;
    badgesEl.innerHTML = rows.map(function (row) {
      var slug = row.getAttribute('data-rank');
      var icon = row.querySelector('.profile-rank-icon').textContent;
      var name = row.querySelector('.profile-rank-name').textContent;
      var earned = !!(progress[slug] && progress[slug].completed);
      return '<span class="quiz-badge' + (earned ? ' is-earned' : '') + '" title="' + name + (earned ? '' : ' (non débloqué)') + '">' + icon + '</span>';
    }).join('');
  }

  function renderRanks(progress) {
    var rows = getRankRows();
    rows.forEach(function (row, index) {
      var slug = row.getAttribute('data-rank');
      var total = parseInt(row.getAttribute('data-total'), 10) || 25;
      var entry = progress[slug];
      var completed = !!(entry && entry.completed);
      var best = entry ? entry.bestScore : 0;
      var pct = Math.round((best / total) * 100);

      var prevSlug = index > 0 ? rows[index - 1].getAttribute('data-rank') : null;
      var unlocked = index === 0 || !!(progress[prevSlug] && progress[prevSlug].completed);

      var fill = row.querySelector('.quiz-rank-progress-fill');
      var status = row.querySelector('.profile-rank-status');
      if (fill) fill.style.width = pct + '%';
      if (status) status.textContent = completed ? ('Validé — ' + best + '/' + total) : (unlocked ? 'En cours' : 'Verrouillé');
      row.classList.toggle('is-completed', completed);
      row.classList.toggle('is-locked', !unlocked);
    });
    renderBadges(rows, progress);
  }

  function showGate() {
    gateScreen.hidden = false;
    contentScreen.hidden = true;
  }

  function showContent(user, progress) {
    gateScreen.hidden = true;
    contentScreen.hidden = false;
    document.getElementById('profile-email').textContent = user.email;
    renderRanks(progress);
  }

  function handleAuthState() {
    if (!firebaseConfigured) {
      showGate();
      return;
    }
    if (!window.AtlasAuth || !window.AtlasAuth.isReady()) return;

    var user = window.AtlasAuth.getCurrentUser();
    if (!user) {
      showGate();
      return;
    }

    initFirestore().then(function () {
      return loadProgress(user.uid);
    }).then(function (progress) {
      showContent(user, progress);
    });
  }

  document.addEventListener('atlas-auth-changed', handleAuthState);

  var gateBtn = document.getElementById('profile-login-gate-btn');
  if (gateBtn) {
    gateBtn.addEventListener('click', function () {
      var accountToggle = document.getElementById('account-toggle');
      if (accountToggle) accountToggle.click();
    });
  }

  var logoutBtn = document.getElementById('profile-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      if (window.AtlasAuth) window.AtlasAuth.signOutUser();
    });
  }

  handleAuthState();

})();
