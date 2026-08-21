/* Atlas Rising — panneau admin des articles (/admin-cms.html)
 *
 * Réservé au propriétaire du site (vérifié côté client ici pour l'UX, et
 * côté serveur par firestore.rules — collection `cms_actions`, voir la
 * condition request.auth.token.email == OWNER_EMAIL là-bas, à garder
 * synchronisée avec la constante ci-dessous).
 *
 * Architecture : cette page ne modifie JAMAIS un article directement (les
 * articles sont des fichiers JSON dans un dépôt git, pas dans Firestore).
 * Chaque action (créer/modifier/supprimer/épingler/remplacer une photo/
 * générer un prompt ou une légende) dépose un document dans la collection
 * `cms_actions` ; agents/admin_sync_agent.py (côté serveur, poll toutes
 * les 2 min) l'exécute réellement — édite/supprime le fichier JSON,
 * régénère le site, commit et pousse sur GitHub. D'où le badge "en
 * attente" affiché tant que status != 'done'/'error'.
 */

import { firebaseConfigured, firebaseAppPromise } from './firebase-config.js';

const OWNER_EMAIL = 'ochfy.youssef@gmail.com';
const CATEGORY_NAMES = {
  football: 'Football',
  transferts: 'Transferts',
  geomaroc: 'GEOPOLITICS',
  blog: 'Opinion',
};

(function () {

  var page = document.getElementById('admin-cms-page');
  if (!page) return;

  var loginGate = document.getElementById('admin-login-gate');
  var deniedGate = document.getElementById('admin-denied-gate');
  var content = document.getElementById('admin-cms-content');
  var db = null;
  var firestoreFns = null;
  var storage = null;
  var storageFns = null;
  var articles = [];

  function initFirebase() {
    if (!firebaseConfigured) return Promise.resolve(false);
    return firebaseAppPromise.then(function (app) {
      return Promise.all([
        import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js'),
        import('https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js'),
      ]).then(function (mods) {
        var firestoreMod = mods[0];
        var storageMod = mods[1];
        db = firestoreMod.initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
        firestoreFns = firestoreMod;
        storage = storageMod.getStorage(app);
        storageFns = storageMod;
        return true;
      });
    });
  }

  function showLoginGate() {
    loginGate.hidden = false;
    deniedGate.hidden = true;
    content.hidden = true;
  }

  function showDenied() {
    loginGate.hidden = true;
    deniedGate.hidden = false;
    content.hidden = true;
  }

  function showContent() {
    loginGate.hidden = true;
    deniedGate.hidden = true;
    content.hidden = false;
  }

  function handleAuthState() {
    if (!firebaseConfigured) { showLoginGate(); return; }
    if (!window.AtlasAuth || !window.AtlasAuth.isReady()) return;

    var user = window.AtlasAuth.getCurrentUser();
    if (!user) { showLoginGate(); return; }
    if (user.email !== OWNER_EMAIL) { showDenied(); return; }

    showContent();
    initFirebase().then(function () { loadArticles(); });
  }

  document.addEventListener('atlas-auth-changed', handleAuthState);

  var gateBtn = document.getElementById('admin-login-gate-btn');
  if (gateBtn) {
    gateBtn.addEventListener('click', function () {
      var accountToggle = document.getElementById('account-toggle');
      if (accountToggle) accountToggle.click();
    });
  }

  /* ---------- Chargement de la liste ---------- */

  var listEl = document.getElementById('admin-cms-list');
  var loadingEl = document.getElementById('admin-cms-loading');
  var searchInput = document.getElementById('admin-cms-search');

  function loadArticles() {
    fetch('static/admin-articles-index.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        articles = data;
        renderList();
      })
      .catch(function () {
        loadingEl.textContent = "Impossible de charger la liste des articles.";
      });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function renderList() {
    var query = (searchInput.value || '').trim().toLowerCase();
    var filtered = query
      ? articles.filter(function (a) { return a.title.toLowerCase().indexOf(query) !== -1; })
      : articles;

    if (!filtered.length) {
      listEl.innerHTML = '<p class="admin-ads-empty">Aucun article trouvé.</p>';
      return;
    }

    listEl.innerHTML = filtered.slice(0, 200).map(function (a) {
      var thumb = a.image
        ? '<img class="admin-cms-thumb" src="../' + a.image + '" alt="" loading="lazy">'
        : '<span class="admin-cms-thumb admin-cms-thumb-empty">?</span>';
      return (
        '<div class="admin-ad-row admin-cms-row" data-slug="' + escapeHtml(a.slug) + '">' +
        '<div class="admin-ad-main">' +
        thumb +
        '<span class="admin-ad-type-badge">' + escapeHtml(a.category) + '</span>' +
        '<span class="admin-ad-name">' + escapeHtml(a.title) + '</span>' +
        '<span class="admin-ad-placement">' + escapeHtml(a.date) + (a.pinned ? ' · 📌 épinglé' : '') + '</span>' +
        '</div>' +
        '<div class="admin-ad-actions">' +
        '<button type="button" class="admin-cms-pin-btn" data-slug="' + escapeHtml(a.slug) + '" data-pinned="' + (a.pinned ? 'true' : 'false') + '">' + (a.pinned ? 'Désépingler' : 'Épingler') + '</button>' +
        '<button type="button" class="admin-ad-edit-btn admin-cms-edit-btn" data-slug="' + escapeHtml(a.slug) + '">Modifier</button>' +
        '<button type="button" class="admin-ad-delete-btn admin-cms-delete-btn" data-slug="' + escapeHtml(a.slug) + '">Supprimer</button>' +
        '</div>' +
        '</div>'
      );
    }).join('');

    Array.prototype.forEach.call(listEl.querySelectorAll('.admin-cms-edit-btn'), function (btn) {
      btn.addEventListener('click', function () { openEditPanel(btn.getAttribute('data-slug')); });
    });
    Array.prototype.forEach.call(listEl.querySelectorAll('.admin-cms-delete-btn'), function (btn) {
      btn.addEventListener('click', function () { deleteArticle(btn.getAttribute('data-slug')); });
    });
    Array.prototype.forEach.call(listEl.querySelectorAll('.admin-cms-pin-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var slug = btn.getAttribute('data-slug');
        var currentlyPinned = btn.getAttribute('data-pinned') === 'true';
        togglePinned(slug, !currentlyPinned);
      });
    });
  }

  if (searchInput) searchInput.addEventListener('input', renderList);

  /* ---------- Actions -> file d'attente cms_actions ---------- */

  function queueAction(type, slug, payload) {
    return firestoreFns.addDoc(firestoreFns.collection(db, 'cms_actions'), {
      type: type,
      slug: slug || null,
      payload: payload || {},
      status: 'pending',
      result: null,
      error: null,
      createdAt: firestoreFns.serverTimestamp(),
    });
  }

  function uploadPhoto(file) {
    var path = 'cms-uploads/' + Date.now() + '-' + file.name.replace(/[^a-zA-Z0-9.\-]/g, '_');
    var fileRef = storageFns.ref(storage, path);
    return storageFns.uploadBytes(fileRef, file).then(function () {
      return storageFns.getDownloadURL(fileRef);
    });
  }

  function deleteArticle(slug) {
    if (!window.confirm('Supprimer définitivement cet article ? Cette action passera en file d\'attente (exécutée sous 2 min).')) return;
    queueAction('delete_article', slug, {}).then(function () {
      window.alert('Suppression mise en file d\'attente.');
    });
  }

  function togglePinned(slug, pinned) {
    queueAction('toggle_pinned', slug, { pinned: pinned }).then(function () {
      window.alert((pinned ? 'Épinglage' : 'Désépinglage') + ' mis en file d\'attente.');
    });
  }

  /* ---------- Nouvel article ---------- */

  var newForm = document.getElementById('admin-new-form');
  var newFeedback = document.getElementById('new-form-feedback');

  function showFeedback(el, message) {
    el.textContent = message;
    el.hidden = false;
    setTimeout(function () { el.hidden = true; }, 5000);
  }

  function splitParagraphs(text) {
    return text.split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
  }

  if (newForm) {
    newForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var submitBtn = document.getElementById('new-submit-btn');
      submitBtn.disabled = true;

      var title = document.getElementById('new-title').value.trim();
      var categorySlug = document.getElementById('new-category').value;
      var tags = document.getElementById('new-tags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
      var body = splitParagraphs(document.getElementById('new-body').value);
      var photoFile = document.getElementById('new-photo').files[0];

      var photoPromise = photoFile ? uploadPhoto(photoFile) : Promise.resolve(null);

      photoPromise
        .then(function (photoUrl) {
          return queueAction('create_article', null, {
            title: title,
            category_slug: categorySlug,
            category: CATEGORY_NAMES[categorySlug] || categorySlug,
            tags: tags,
            body_paragraphs: body,
            photoUrl: photoUrl,
          });
        })
        .then(function () {
          showFeedback(newFeedback, 'Article mis en file d\'attente — publication sous 2 min.');
          newForm.reset();
        })
        .catch(function () { showFeedback(newFeedback, 'Erreur, réessaie.'); })
        .finally(function () { submitBtn.disabled = false; });
    });
  }

  /* ---------- Panneau d'édition ---------- */

  var editPanel = document.getElementById('admin-cms-edit-panel');
  var editOverlay = document.getElementById('admin-cms-edit-overlay');
  var editClose = document.getElementById('admin-cms-edit-close');
  var editForm = document.getElementById('admin-edit-form');
  var editFeedback = document.getElementById('edit-form-feedback');

  function openEditPanel(slug) {
    fetch('static/data/articles/' + slug + '.json')
      .then(function (r) { return r.json(); })
      .then(function (article) {
        document.getElementById('edit-slug').value = article.slug;
        document.getElementById('edit-title').value = article.title || '';
        document.getElementById('edit-dek').value = article.dek || '';
        document.getElementById('edit-category').value = article.category_slug || 'football';
        document.getElementById('edit-tags').value = (article.tags || []).join(', ');
        document.getElementById('edit-body').value = (article.body_paragraphs || []).join('\n\n');
        document.getElementById('edit-photo').value = '';
        resetAiTools();
        editPanel.hidden = false;
      })
      .catch(function () { window.alert('Impossible de charger cet article.'); });
  }

  function closeEditPanel() { editPanel.hidden = true; }
  if (editClose) editClose.addEventListener('click', closeEditPanel);
  if (editOverlay) editOverlay.addEventListener('click', closeEditPanel);

  if (editForm) {
    editForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var slug = document.getElementById('edit-slug').value;
      var photoFile = document.getElementById('edit-photo').files[0];
      var photoPromise = photoFile ? uploadPhoto(photoFile) : Promise.resolve(null);

      photoPromise
        .then(function (photoUrl) {
          return queueAction('edit_article', slug, {
            title: document.getElementById('edit-title').value.trim(),
            dek: document.getElementById('edit-dek').value.trim(),
            category_slug: document.getElementById('edit-category').value,
            category: CATEGORY_NAMES[document.getElementById('edit-category').value] || '',
            tags: document.getElementById('edit-tags').value.split(',').map(function (t) { return t.trim(); }).filter(Boolean),
            body_paragraphs: splitParagraphs(document.getElementById('edit-body').value),
            photoUrl: photoUrl,
          });
        })
        .then(function () {
          showFeedback(editFeedback, 'Modification mise en file d\'attente — appliquée sous 2 min.');
        })
        .catch(function () { showFeedback(editFeedback, 'Erreur, réessaie.'); });
    });
  }

  /* ---------- Outils IA (prompt photo teaser / légende) ---------- */

  var genPromptBtn = document.getElementById('admin-gen-prompt-btn');
  var genPromptResult = document.getElementById('admin-gen-prompt-result');
  var genCaptionBtn = document.getElementById('admin-gen-caption-btn');
  var genCaptionResult = document.getElementById('admin-gen-caption-result');
  var activeUnsubscribers = [];

  function resetAiTools() {
    activeUnsubscribers.forEach(function (unsub) { unsub(); });
    activeUnsubscribers = [];
    genPromptResult.hidden = true;
    genPromptResult.textContent = '';
    genCaptionResult.hidden = true;
    genCaptionResult.textContent = '';
    genPromptBtn.disabled = false;
    genCaptionBtn.disabled = false;
  }

  function runAiAction(type, button, resultEl) {
    var slug = document.getElementById('edit-slug').value;
    button.disabled = true;
    resultEl.hidden = false;
    resultEl.textContent = 'Génération en cours (jusqu\'à 2 min)…';

    queueAction(type, slug, {}).then(function (docRef) {
      var unsub = firestoreFns.onSnapshot(docRef, function (snap) {
        var data = snap.data();
        if (!data || data.status === 'pending') return;
        button.disabled = false;
        if (data.status === 'done') {
          resultEl.textContent = data.result || '(résultat vide)';
          resultEl.classList.add('admin-cms-ai-result-ready');
        } else {
          resultEl.textContent = 'Échec : ' + (data.error || 'raison inconnue');
        }
        unsub();
      });
      activeUnsubscribers.push(unsub);
    });
  }

  if (genPromptBtn) genPromptBtn.addEventListener('click', function () {
    runAiAction('generate_teaser_prompt', genPromptBtn, genPromptResult);
  });
  if (genCaptionBtn) genCaptionBtn.addEventListener('click', function () {
    runAiAction('generate_caption', genCaptionBtn, genCaptionResult);
  });

  handleAuthState();

})();
