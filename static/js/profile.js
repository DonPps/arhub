/* Atlas Rising — page profil (compte + progression Atlas Quiz, lecture seule) */

import { firebaseConfigured, firebaseAppPromise } from './firebase-config.js';
import { loadFavorites, removeFavorite, toggleFavorite } from './favorites.js';

(function () {

  var page = document.getElementById('profile-page');
  if (!page) return;

  var root = document.body.getAttribute('data-root') || '';
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

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function renderFavoritesList(containerId, type, uid, names) {
    var el = document.getElementById(containerId);
    if (!el) return;
    if (!names.length) {
      el.innerHTML = '<p class="profile-favorites-empty">' +
        (type === 'teams' ? "Aucune équipe favorite pour l'instant — ajoute-en depuis la page Matchs." : "Aucune compétition favorite pour l'instant.") +
        '</p>';
      return;
    }
    el.innerHTML = names.map(function (name) {
      return '<span class="profile-favorite-chip">' + escapeHtml(name) +
        '<button type="button" class="profile-favorite-remove" data-type="' + type + '" data-name="' + escapeHtml(name) + '" aria-label="Retirer ' + escapeHtml(name) + ' des favoris">&times;</button></span>';
    }).join('');

    Array.prototype.forEach.call(el.querySelectorAll('.profile-favorite-remove'), function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        removeFavorite(db, firestoreFns, uid, btn.getAttribute('data-type'), btn.getAttribute('data-name'))
          .then(function () { renderFavorites(uid); })
          .catch(function (e) { console.error('Échec suppression favori:', e); btn.disabled = false; });
      });
    });
  }

  function renderFavorites(uid) {
    loadFavorites(db, firestoreFns, uid).then(function (favs) {
      renderFavoritesList('profile-favorite-teams', 'teams', uid, favs.teams);
      renderFavoritesList('profile-favorite-competitions', 'competitions', uid, favs.competitions);
    });
  }

  /* ---------- Recherche équipe/compétition à suivre (favori sans qu'elle
   * joue aujourd'hui) — construite à partir de tout ce que le pipeline
   * Matchs a déjà croisé (static/data/teams.json /competitions.json),
   * pas d'appel API depuis le navigateur. */
  var teamsIndexPromise = null;
  var competitionsIndexPromise = null;
  var favoriteSearchInput = document.getElementById('favorite-search-input');
  var favoriteSearchResults = document.getElementById('favorite-search-results');

  function loadIndex(file) {
    return fetch(root + 'static/data/' + file).then(function (r) { return r.json(); }).catch(function () { return []; });
  }

  function renderSearchResultRow(type, name, crest) {
    return '<div class="favorite-search-row">' +
      (crest ? '<img src="' + crest + '" alt="" class="favorite-search-crest">' : '<span class="favorite-search-crest crest-fallback">' + escapeHtml(name.charAt(0)) + '</span>') +
      '<span class="favorite-search-name">' + escapeHtml(name) + '</span>' +
      '<button type="button" class="favorite-search-add" data-type="' + type + '" data-name="' + escapeHtml(name) + '">Ajouter</button>' +
      '</div>';
  }

  function renderSearchResults(user, teams, comps) {
    if (!teams.length && !comps.length) {
      favoriteSearchResults.innerHTML = '<p class="favorite-search-empty">Aucun résultat — seules les équipes/compétitions déjà croisées dans les matchs suivis apparaissent ici.</p>';
      favoriteSearchResults.hidden = false;
      return;
    }
    favoriteSearchResults.innerHTML =
      teams.map(function (t) { return renderSearchResultRow('teams', t.name, t.crest); }).join('') +
      comps.map(function (c) { return renderSearchResultRow('competitions', c.name, c.logo); }).join('');
    favoriteSearchResults.hidden = false;

    Array.prototype.forEach.call(favoriteSearchResults.querySelectorAll('.favorite-search-add'), function (btn) {
      btn.addEventListener('click', function () {
        if (!user || !db) return;
        btn.disabled = true;
        toggleFavorite(db, firestoreFns, user.uid, btn.getAttribute('data-type'), btn.getAttribute('data-name'))
          .then(function () {
            renderFavorites(user.uid);
            favoriteSearchInput.value = '';
            favoriteSearchResults.hidden = true;
          })
          .catch(function (e) { console.error('Échec ajout favori:', e); btn.disabled = false; });
      });
    });
  }

  if (favoriteSearchInput) {
    favoriteSearchInput.addEventListener('input', function () {
      var q = favoriteSearchInput.value.trim().toLowerCase();
      var user = window.AtlasAuth && window.AtlasAuth.getCurrentUser();
      if (!q || !user) { favoriteSearchResults.hidden = true; favoriteSearchResults.innerHTML = ''; return; }
      if (!teamsIndexPromise) teamsIndexPromise = loadIndex('teams.json');
      if (!competitionsIndexPromise) competitionsIndexPromise = loadIndex('competitions.json');
      Promise.all([teamsIndexPromise, competitionsIndexPromise]).then(function (results) {
        var teams = results[0].filter(function (t) { return t.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 6);
        var comps = results[1].filter(function (c) { return c.name.toLowerCase().indexOf(q) !== -1; }).slice(0, 6);
        renderSearchResults(user, teams, comps);
      });
    });
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
      renderFavorites(user.uid);
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
