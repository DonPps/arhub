/* Atlas Rising — panneau admin des emplacements publicitaires (/admin-ads.html)
 *
 * Réservé au propriétaire du site (vérifié côté client ici pour l'UX, et
 * côté serveur par firestore.rules pour la vraie sécurité — voir la
 * condition request.auth.token.email == OWNER_EMAIL là-bas, qui doit
 * rester synchronisée avec la constante ci-dessous).
 *
 * CRUD complet sur la collection Firestore "ads" consommée par
 * static/js/ads/ad-manager.js. Aucun redéploiement du site n'est
 * nécessaire pour qu'un changement fait ici apparaisse en ligne — la
 * page publique relit Firestore à chaque chargement.
 */

import { firebaseConfigured, firebaseAppPromise } from './firebase-config.js';

const OWNER_EMAIL = 'ochfy.youssef@gmail.com';

(function () {

  var page = document.getElementById('admin-ads-page');
  if (!page) return;

  var loginGate = document.getElementById('admin-login-gate');
  var deniedGate = document.getElementById('admin-denied-gate');
  var content = document.getElementById('admin-ads-content');
  var db = null;
  var firestoreFns = null;
  var editingId = null;

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
    initFirestore().then(function () { refreshList(); });
  }

  document.addEventListener('atlas-auth-changed', handleAuthState);

  var gateBtn = document.getElementById('admin-login-gate-btn');
  if (gateBtn) {
    gateBtn.addEventListener('click', function () {
      var accountToggle = document.getElementById('account-toggle');
      if (accountToggle) accountToggle.click();
    });
  }

  /* ---------- Formulaire (création / édition) ---------- */

  var form = document.getElementById('admin-ads-form');
  var typeSelect = document.getElementById('ad-type');
  var sponsorFields = document.getElementById('admin-fields-sponsor');
  var adsenseFields = document.getElementById('admin-fields-adsense');
  var submitBtn = document.getElementById('admin-submit-btn');
  var cancelBtn = document.getElementById('admin-cancel-btn');
  var feedback = document.getElementById('admin-form-feedback');

  function toggleTypeFields() {
    var isAdsense = typeSelect.value === 'adsense';
    adsenseFields.hidden = !isAdsense;
    sponsorFields.hidden = isAdsense;
  }
  typeSelect.addEventListener('change', toggleTypeFields);
  toggleTypeFields();

  function resetForm() {
    form.reset();
    document.getElementById('ad-id').value = '';
    document.getElementById('ad-priority').value = 1;
    document.getElementById('ad-enabled').checked = true;
    editingId = null;
    submitBtn.textContent = 'Créer la publicité';
    cancelBtn.hidden = true;
    toggleTypeFields();
  }

  function fillForm(ad) {
    editingId = ad.id;
    document.getElementById('ad-id').value = ad.id;
    document.getElementById('ad-name').value = ad.name || '';
    typeSelect.value = ad.type || 'sponsor';
    document.getElementById('ad-placement').value = ad.placement || '';
    document.getElementById('ad-priority').value = ad.priority || 1;
    document.getElementById('ad-enabled').checked = ad.enabled !== false;
    document.getElementById('ad-start').value = ad.startDate || '';
    document.getElementById('ad-end').value = ad.endDate || '';
    document.getElementById('ad-title').value = ad.title || '';
    document.getElementById('ad-description').value = ad.description || '';
    document.getElementById('ad-image').value = ad.image || '';
    document.getElementById('ad-logo').value = ad.logo || '';
    document.getElementById('ad-button').value = ad.button || '';
    document.getElementById('ad-url').value = ad.url || '';
    document.getElementById('ad-slot').value = ad.slot || '';
    document.getElementById('ad-format').value = ad.format || '';
    document.getElementById('ad-responsive').checked = ad.responsive !== false;
    toggleTypeFields();
    submitBtn.textContent = 'Enregistrer les modifications';
    cancelBtn.hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function showFeedback(message) {
    feedback.textContent = message;
    feedback.hidden = false;
    setTimeout(function () { feedback.hidden = true; }, 4000);
  }

  cancelBtn.addEventListener('click', resetForm);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!db) return;

    var type = typeSelect.value;
    var data = {
      name: document.getElementById('ad-name').value.trim(),
      type: type,
      placement: document.getElementById('ad-placement').value.trim(),
      priority: parseInt(document.getElementById('ad-priority').value, 10) || 0,
      enabled: document.getElementById('ad-enabled').checked,
      startDate: document.getElementById('ad-start').value || null,
      endDate: document.getElementById('ad-end').value || null,
    };

    if (type === 'adsense') {
      data.slot = document.getElementById('ad-slot').value.trim();
      data.format = document.getElementById('ad-format').value.trim();
      data.responsive = document.getElementById('ad-responsive').checked;
    } else {
      data.title = document.getElementById('ad-title').value.trim();
      data.description = document.getElementById('ad-description').value.trim();
      data.image = document.getElementById('ad-image').value.trim();
      data.logo = document.getElementById('ad-logo').value.trim();
      data.button = document.getElementById('ad-button').value.trim();
      data.url = document.getElementById('ad-url').value.trim();
    }

    submitBtn.disabled = true;
    var promise;
    if (editingId) {
      promise = firestoreFns.updateDoc(firestoreFns.doc(db, 'ads', editingId), data);
    } else {
      data.impressions = 0;
      data.clicks = 0;
      promise = firestoreFns.addDoc(firestoreFns.collection(db, 'ads'), data);
    }

    promise
      .then(function () {
        showFeedback(editingId ? 'Publicité mise à jour.' : 'Publicité créée.');
        resetForm();
        refreshList();
      })
      .catch(function () { showFeedback('Erreur, réessaie.'); })
      .finally(function () { submitBtn.disabled = false; });
  });

  /* ---------- Liste ---------- */

  var listEl = document.getElementById('admin-ads-list');
  var emptyEl = document.getElementById('admin-ads-empty');

  function refreshList() {
    firestoreFns.getDocs(firestoreFns.collection(db, 'ads'))
      .then(function (snap) {
        var ads = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        ads.sort(function (a, b) { return (b.priority || 0) - (a.priority || 0); });
        renderList(ads);
      })
      .catch(function () { showFeedback('Impossible de charger les publicités.'); });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function renderList(ads) {
    Array.prototype.slice.call(listEl.querySelectorAll('.admin-ad-row')).forEach(function (el) { el.remove(); });
    emptyEl.hidden = ads.length > 0;

    ads.forEach(function (ad) {
      var row = document.createElement('div');
      row.className = 'admin-ad-row' + (ad.enabled === false ? ' is-disabled' : '');
      row.innerHTML =
        '<div class="admin-ad-main">' +
          '<span class="admin-ad-type-badge admin-ad-type-' + escapeHtml(ad.type) + '">' + (ad.type === 'adsense' ? 'AdSense' : 'Sponsor') + '</span>' +
          '<span class="admin-ad-name">' + escapeHtml(ad.name) + '</span>' +
          '<span class="admin-ad-placement">' + escapeHtml(ad.placement) + '</span>' +
        '</div>' +
        '<div class="admin-ad-stats">' +
          '<span title="Priorité">P' + (ad.priority || 0) + '</span>' +
          '<span title="Impressions">👁 ' + (ad.impressions || 0) + '</span>' +
          '<span title="Clics">🖱 ' + (ad.clicks || 0) + '</span>' +
        '</div>' +
        '<div class="admin-ad-actions">' +
          '<button type="button" class="admin-ad-toggle-btn" data-id="' + ad.id + '" data-enabled="' + (ad.enabled !== false) + '">' + (ad.enabled === false ? 'Activer' : 'Désactiver') + '</button>' +
          '<button type="button" class="admin-ad-edit-btn" data-id="' + ad.id + '">Modifier</button>' +
          '<button type="button" class="admin-ad-delete-btn" data-id="' + ad.id + '">Supprimer</button>' +
        '</div>';

      row.querySelector('.admin-ad-edit-btn').addEventListener('click', function () { fillForm(ad); });

      row.querySelector('.admin-ad-toggle-btn').addEventListener('click', function (e) {
        var newState = e.target.getAttribute('data-enabled') !== 'true';
        firestoreFns.updateDoc(firestoreFns.doc(db, 'ads', ad.id), { enabled: newState })
          .then(refreshList)
          .catch(function () { showFeedback('Erreur, réessaie.'); });
      });

      row.querySelector('.admin-ad-delete-btn').addEventListener('click', function () {
        if (!window.confirm('Supprimer définitivement "' + ad.name + '" ?')) return;
        firestoreFns.deleteDoc(firestoreFns.doc(db, 'ads', ad.id))
          .then(refreshList)
          .catch(function () { showFeedback('Erreur, réessaie.'); });
      });

      listEl.insertBefore(row, emptyEl);
    });
  }

  handleAuthState();

})();
