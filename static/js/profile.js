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

  function loadUserProfile(uid, user) {
    var ref = firestoreFns.doc(db, 'users', uid);
    return withTimeout(
      firestoreFns.getDoc(ref).then(function (snap) {
        return snap.exists() ? snap.data() : {};
      }).catch(function () {
        return {};
      }),
      8000,
      {}
    ).then(function (data) {
      return {
        nickname: data.nickname || user.displayName || (user.email || '').split('@')[0],
        bio: data.bio || '',
      };
    });
  }

  function saveUserProfile(uid, nickname, bio) {
    var ref = firestoreFns.doc(db, 'users', uid);
    return firestoreFns.setDoc(ref, { nickname: nickname, bio: bio }, { merge: true });
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

  function renderAvatar(user) {
    var avatarEl = document.getElementById('profile-avatar');
    if (!avatarEl) return;
    if (user.photoURL) {
      avatarEl.innerHTML = '<img src="' + user.photoURL + '" alt="Photo de profil">';
    } else {
      avatarEl.textContent = '👤';
    }
  }

  function showContent(user, progress, userProfile) {
    gateScreen.hidden = true;
    contentScreen.hidden = false;
    document.getElementById('profile-email').textContent = user.email;
    document.getElementById('profile-nickname').textContent = userProfile.nickname;
    document.getElementById('profile-nickname-input').value = userProfile.nickname;
    document.getElementById('profile-bio-input').value = userProfile.bio;
    renderAvatar(user);
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
      return Promise.all([loadProgress(user.uid), loadUserProfile(user.uid, user)]);
    }).then(function (results) {
      showContent(user, results[0], results[1]);
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

  var editForm = document.getElementById('profile-edit-form');
  if (editForm) {
    editForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var user = window.AtlasAuth && window.AtlasAuth.getCurrentUser();
      if (!user) return;
      var nickname = document.getElementById('profile-nickname-input').value.trim();
      var bio = document.getElementById('profile-bio-input').value.trim();
      var feedback = document.getElementById('profile-edit-feedback');
      var button = editForm.querySelector('button');
      if (!nickname) return;
      button.disabled = true;
      saveUserProfile(user.uid, nickname, bio).then(function () {
        document.getElementById('profile-nickname').textContent = nickname;
        feedback.textContent = 'Profil enregistré.';
        feedback.hidden = false;
      }).catch(function (err) {
        console.error('profile save error:', err);
        feedback.textContent = "Erreur, réessaie.";
        feedback.hidden = false;
      }).finally(function () {
        button.disabled = false;
      });
    });
  }

  handleAuthState();

})();
