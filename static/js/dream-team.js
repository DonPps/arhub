/* Atlas Rising — Dream Team : placer les cartes possédées sur un terrain
 * selon leur poste, formation 4-3-3 unique pour cette première passe.
 * Partageable : dream-team.html?u=<uid> affiche le onze de cet utilisateur
 * en lecture seule (dreamTeams/{uid} est public en lecture, voir
 * firestore.rules). Sans ?u=, la page édite le Dream Team de l'utilisateur
 * connecté. */

import { ensureFirestore, getFirestoreRefs, loadOwnedCardSlugs } from './points.js';

(function () {
  var page = document.getElementById('dreamteam-page');
  if (!page) return;

  var root = document.body.getAttribute('data-root') || '';
  var pitch = document.getElementById('dreamteam-pitch');
  var loginGate = document.getElementById('dreamteam-login-gate');
  var emptyNote = document.getElementById('dreamteam-empty-note');
  var shareBtn = document.getElementById('dreamteam-share-btn');
  var ownLink = document.getElementById('dreamteam-own-link');

  var pickerModal = document.getElementById('dreamteam-picker-modal');
  var pickerOverlay = document.getElementById('dreamteam-picker-overlay');
  var pickerClose = document.getElementById('dreamteam-picker-close');
  var pickerGrid = document.getElementById('dreamteam-picker-grid');
  var pickerTitle = document.getElementById('dreamteam-picker-title');

  var SLOT_POSITIONS = {
    GK: ['GK'], LB: ['LB'], RB: ['RB'], CB1: ['CB'], CB2: ['CB'],
    CM1: ['CDM', 'CM', 'CAM'], CM2: ['CDM', 'CM', 'CAM'], CM3: ['CDM', 'CM', 'CAM'],
    LW: ['LW'], RW: ['RW'], ST: ['ST'],
  };

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
  function rarityClass(rarity) {
    return 'rarity-' + (rarity || 'common').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  var queryUid = new URLSearchParams(window.location.search).get('u');
  var currentUser = null;
  var allCards = [];
  var cardsBySlug = {};
  var ownedSlugs = [];
  var teamData = { formation: '4-3-3', slots: {} };
  var editable = false;
  var targetUid = null;
  var unsubscribeTeam = null;
  var activeSlotId = null;

  function loadCardsIndex() {
    return fetch(root + 'static/data/cards.json').then(function (r) { return r.json(); }).catch(function () { return []; });
  }

  function renderPitch() {
    Array.prototype.forEach.call(pitch.querySelectorAll('.dreamteam-slot'), function (btn) {
      var slotId = btn.getAttribute('data-slot');
      var cardSlug = teamData.slots && teamData.slots[slotId];
      var card = cardSlug && cardsBySlug[cardSlug];
      btn.classList.toggle('is-filled', !!card);
      btn.classList.toggle('is-editable', editable);
      btn.disabled = !editable;
      if (card) {
        btn.innerHTML = '<img src="' + root + escapeHtml(card.image) + '" alt="' + escapeHtml(card.name || '') + '">' +
          '<span class="dreamteam-slot-name">' + escapeHtml(card.name || '') + '</span>';
      } else {
        btn.innerHTML = '<span class="dreamteam-slot-plus">' + (editable ? '+' : '') + '</span>' +
          '<span class="dreamteam-slot-label">' + escapeHtml(btn.getAttribute('data-label')) + '</span>';
      }
    });
  }

  function openPicker(slotId) {
    if (!editable) return;
    activeSlotId = slotId;
    var accepted = SLOT_POSITIONS[slotId] || [];
    var slotBtn = pitch.querySelector('[data-slot="' + slotId + '"]');
    var options = allCards.filter(function (c) {
      return ownedSlugs.indexOf(c.slug) !== -1 && accepted.indexOf(c.position) !== -1;
    });
    pickerTitle.textContent = 'Choisir : ' + (slotBtn ? slotBtn.getAttribute('data-label') : slotId);
    if (!options.length) {
      pickerGrid.innerHTML = '<p class="matches-empty">Aucune carte possédée pour ce poste pour l\'instant.</p>';
    } else {
      pickerGrid.innerHTML = options.map(function (c) {
        return '<div class="shop-card dreamteam-picker-card" data-card-slug="' + escapeHtml(c.slug) + '">' +
          '<div class="shop-card-media"><img src="' + root + escapeHtml(c.image) + '" alt="' + escapeHtml(c.name || '') + '" loading="lazy">' +
          '<span class="shop-card-rarity ' + rarityClass(c.rarity) + '">' + escapeHtml(c.rarity || '') + '</span></div>' +
          '<div class="shop-card-body"><h3>' + escapeHtml(c.name || '') + '</h3></div></div>';
      }).join('');
      Array.prototype.forEach.call(pickerGrid.querySelectorAll('.dreamteam-picker-card'), function (el) {
        el.addEventListener('click', function () {
          assignSlot(activeSlotId, el.getAttribute('data-card-slug'));
          closePicker();
        });
      });
    }
    pickerModal.hidden = false;
    requestAnimationFrame(function () { pickerModal.classList.add('is-open'); });
    document.body.classList.add('drawer-open');
  }
  function closePicker() {
    pickerModal.classList.remove('is-open');
    document.body.classList.remove('drawer-open');
    setTimeout(function () { pickerModal.hidden = true; }, 250);
  }
  if (pickerClose) pickerClose.addEventListener('click', closePicker);
  if (pickerOverlay) pickerOverlay.addEventListener('click', closePicker);

  function ensureTeamDoc(uid) {
    var refs = getFirestoreRefs();
    var ref = refs.firestoreFns.doc(refs.db, 'dreamTeams', uid);
    return refs.firestoreFns.getDoc(ref).then(function (snap) {
      if (snap.exists()) return ref;
      return refs.firestoreFns.setDoc(ref, { formation: '4-3-3', slots: {} }).then(function () { return ref; });
    });
  }

  function assignSlot(slotId, cardSlug) {
    if (!editable || !currentUser) return;
    ensureFirestore().then(function () {
      return ensureTeamDoc(currentUser.uid);
    }).then(function (ref) {
      var refs = getFirestoreRefs();
      var update = {};
      update.formation = '4-3-3';
      update['slots.' + slotId] = cardSlug;
      update.updatedAt = refs.firestoreFns.serverTimestamp();
      return refs.firestoreFns.updateDoc(ref, update);
    }).catch(function (e) { console.error('Échec sauvegarde Dream Team:', e); });
  }

  function watchTeam(uid) {
    if (unsubscribeTeam) { unsubscribeTeam(); unsubscribeTeam = null; }
    ensureFirestore().then(function (ok) {
      if (!ok) return;
      var refs = getFirestoreRefs();
      var ref = refs.firestoreFns.doc(refs.db, 'dreamTeams', uid);
      unsubscribeTeam = refs.firestoreFns.onSnapshot(ref, function (snap) {
        teamData = snap.data() || { formation: '4-3-3', slots: {} };
        renderPitch();
      });
    });
  }

  function refreshMode() {
    var loggedIn = !!currentUser;
    var viewingOther = !!queryUid && (!loggedIn || queryUid !== currentUser.uid);
    targetUid = viewingOther ? queryUid : (loggedIn ? currentUser.uid : null);
    editable = !viewingOther && loggedIn;

    loginGate.hidden = !!targetUid;
    pitch.hidden = !targetUid;
    shareBtn.hidden = !editable;
    ownLink.hidden = !(viewingOther && loggedIn);
    emptyNote.hidden = true;

    if (!targetUid) return;

    teamData = { formation: '4-3-3', slots: {} };
    watchTeam(targetUid);

    if (editable) {
      loadOwnedCardSlugs(currentUser.uid).then(function (slugs) {
        ownedSlugs = slugs;
        emptyNote.hidden = slugs.length > 0;
      });
    }
  }

  document.addEventListener('atlas-auth-changed', function (e) {
    currentUser = (e.detail && e.detail.user) || null;
    refreshMode();
  });

  var gateBtn = document.getElementById('dreamteam-login-gate-btn');
  if (gateBtn) {
    gateBtn.addEventListener('click', function () {
      var toggle = document.getElementById('account-toggle');
      if (toggle) toggle.click();
    });
  }

  if (pitch) {
    pitch.addEventListener('click', function (e) {
      var btn = e.target.closest('.dreamteam-slot');
      if (btn && editable) openPicker(btn.getAttribute('data-slot'));
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', function () {
      if (!currentUser) return;
      var url = window.location.origin + root + 'dream-team.html?u=' + currentUser.uid;
      var title = 'Mon Dream Team Atlas Rising';
      var showCopied = function () {
        var original = shareBtn.innerHTML;
        shareBtn.textContent = 'Lien copié !';
        setTimeout(function () { shareBtn.innerHTML = original; }, 2000);
      };
      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(showCopied).catch(function () {});
      }
    });
  }

  loadCardsIndex().then(fu