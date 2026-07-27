/* Atlas Rising — commentaires d'articles (Firestore, temps réel).
 *
 * Collection "comments/{id}" : chaque document porte articleSlug + uid +
 * nickname (dénormalisé à l'écriture, comme leaderboard) + text +
 * createdAt. Requête filtrée uniquement par articleSlug (égalité simple,
 * pas d'orderBy combiné dans la requête Firestore elle-même — évite un
 * index composite) ; le tri par date se fait côté client après réception.
 */

import { firebaseConfigured, firebaseAppPromise } from './firebase-config.js';

(function () {

  var section = document.getElementById('comments-section');
  if (!section) return;

  var slug = section.getAttribute('data-article-slug');
  var listEl = document.getElementById('comments-list');
  var countEl = document.getElementById('comments-count');
  var loginGate = document.getElementById('comment-login-gate');
  var form = document.getElementById('comment-form');
  var textarea = document.getElementById('comment-textarea');
  var submitBtn = document.getElementById('comment-submit-btn');
  var errorEl = document.getElementById('comment-error');

  var db = null;
  var firestoreFns = null;
  var currentUser = null;
  var unsubscribe = null;

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

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(ts) {
    if (!ts || !ts.toDate) return '';
    var d = ts.toDate();
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
      + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  function renderComments(comments) {
    comments.sort(function (a, b) {
      var ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      var tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });

    countEl.textContent = comments.length;

    if (!comments.length) {
      listEl.innerHTML = '<div class="empty-state">'
        + '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4h16v12H8l-4 4z"/></svg>'
        + '<p class="comments-empty">Aucun commentaire pour l\'instant — sois le premier à réagir.</p>'
        + '</div>';
      return;
    }

    listEl.innerHTML = comments.map(function (c) {
      var canDelete = currentUser && currentUser.uid === c.uid;
      var name = c.nickname || 'Utilisateur';
      return '<div class="comment-item" data-id="' + c.id + '">'
        + '<div class="comment-item-head">'
        + '<span><span class="comment-avatar">' + escapeHtml(name.charAt(0).toUpperCase()) + '</span>'
        + '<span class="comment-author">' + escapeHtml(name) + '</span></span>'
        + '<span class="comment-date">' + formatDate(c.createdAt) + '</span>'
        + '</div>'
        + '<p class="comment-text">' + escapeHtml(c.text) + '</p>'
        + (canDelete ? '<button type="button" class="comment-delete-btn" data-id="' + c.id + '">Supprimer</button>' : '')
        + '</div>';
    }).join('');

    if (currentUser) {
      Array.prototype.forEach.call(listEl.querySelectorAll('.comment-delete-btn'), function (btn) {
        btn.addEventListener('click', function () {
          if (!confirm('Supprimer ce commentaire ?')) return;
          btn.disabled = true;
          firestoreFns.deleteDoc(firestoreFns.doc(db, 'comments', btn.getAttribute('data-id')))
            .catch(function (e) { console.error('Échec suppression commentaire:', e); btn.disabled = false; });
        });
      });
    }
  }

  function listenComments() {
    var q = firestoreFns.query(
      firestoreFns.collection(db, 'comments'),
      firestoreFns.where('articleSlug', '==', slug)
    );
    unsubscribe = firestoreFns.onSnapshot(q, function (snap) {
      var comments = [];
      snap.forEach(function (d) { comments.push(Object.assign({ id: d.id }, d.data())); });
      renderComments(comments);
    }, function (e) {
      console.error('Échec chargement commentaires:', e);
      listEl.innerHTML = '<p class="comments-empty">Impossible de charger les commentaires pour le moment.</p>';
    });
  }

  function getNickname(uid) {
    return firestoreFns.getDoc(firestoreFns.doc(db, 'users', uid))
      .then(function (s) { return s.exists() ? s.data().nickname : null; })
      .catch(function () { return null; })
      .then(function (nickname) {
        return nickname || (currentUser.displayName) || (currentUser.email || 'Utilisateur').split('@')[0];
      });
  }

  function updateAuthUI() {
    var configured = window.AtlasAuth && window.AtlasAuth.isConfigured();
    currentUser = configured ? window.AtlasAuth.getCurrentUser() : null;
    if (loginGate) loginGate.hidden = !!currentUser;
    if (form) form.hidden = !currentUser;
  }

  document.addEventListener('atlas-auth-changed', updateAuthUI);

  if (loginGate) {
    var loginBtn = loginGate.querySelector('.comment-login-btn');
    if (loginBtn) {
      loginBtn.addEventListener('click', function () {
        var toggle = document.getElementById('account-toggle');
        if (toggle) toggle.click();
      });
    }
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (errorEl) errorEl.hidden = true;
      var text = textarea.value.trim();
      if (!text || !currentUser) return;

      submitBtn.disabled = true;
      getNickname(currentUser.uid).then(function (nickname) {
        return firestoreFns.addDoc(firestoreFns.collection(db, 'comments'), {
          articleSlug: slug,
          uid: currentUser.uid,
          nickname: nickname,
          text: text,
          createdAt: firestoreFns.serverTimestamp(),
        });
      }).then(function () {
        textarea.value = '';
      }).catch(function (e) {
        console.error('Échec envoi commentaire:', e);
        if (errorEl) { errorEl.textContent = 'Impossible d\'envoyer le commentaire, réessaie.'; errorEl.hidden = false; }
      }).finally(function () {
        submitBtn.disabled = false;
      });
    });
  }

  if (!firebaseConfigured) {
    listEl.innerHTML = '<p class="comments-empty">Les commentaires ne sont pas encore disponibles.</p>';
    return;
  }
  // Le markup initial (article.html) affiche déjà un skeleton — pas besoin
  // de le réécrire ici, listenComments()/renderComments() le remplacera
  // dès la première réponse Firestore.

  updateAuthUI();
  initFirestore().then(function (ok) {
    if (!ok) return;
    listenComments();
  });

  window.addEventListener('beforeunload', function () {
    if (unsubscribe) unsubscribe();
  });

})();
