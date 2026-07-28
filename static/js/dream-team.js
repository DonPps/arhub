/* Atlas Rising — Dream Team : placer les cartes possédées sur un terrain
 * selon leur poste, formation 4-3-3 unique pour cette première passe.
 * Partageable : play.html?tab=dreamteam&u=<uid> affiche le onze de cet
 * utilisateur en lecture seule (dreamTeams/{uid} est public en lecture,
 * voir firestore.rules). Sans ?u=, la page édite le Dream Team de
 * l'utilisateur connecté. */

import { ensureFirestore, getFirestoreRefs, loadOwnedCardSlugs } from './points.js';
import { cardValue } from './points-config.js';
import { loadTopDreamTeams } from './dreamteam-ranking.js';

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

  /* ---------- Refonte AAA : panneau de stats, chimie, carrousel de
   * collection — éléments additionnels ajoutés dans templates/play.html,
   * uniquement à l'intérieur de #dreamteam-page. ---------- */
  var fieldWrap = document.getElementById('dreamteam-field-wrap');
  var collectionBlock = document.getElementById('dreamteam-collection-block');
  var carousel = document.getElementById('dreamteam-carousel');
  var chemistrySvg = document.getElementById('dreamteam-chemistry-svg');
  var statOverall = document.getElementById('dreamteam-stat-overall');
  var statChemistry = document.getElementById('dreamteam-stat-chemistry');
  var statValue = document.getElementById('dreamteam-stat-value');
  var statCards = document.getElementById('dreamteam-stat-cards');
  var statLegendary = document.getElementById('dreamteam-stat-legendary');

  var coachBlock = document.getElementById('dreamteam-coach-block');
  var coachCard = document.getElementById('dreamteam-coach-card');
  var coachPickerModal = document.getElementById('dreamteam-coach-picker-modal');
  var coachPickerOverlay = document.getElementById('dreamteam-coach-picker-overlay');
  var coachPickerClose = document.getElementById('dreamteam-coach-picker-close');
  var coachPickerGrid = document.getElementById('dreamteam-coach-picker-grid');

  var SLOT_POSITIONS = {
    GK: ['GK'], LB: ['LB'], RB: ['RB'], CB1: ['CB'], CB2: ['CB'],
    CM1: ['CDM', 'CM', 'CAM'], CM2: ['CDM', 'CM', 'CAM'], CM3: ['CDM', 'CM', 'CAM'],
    LW: ['LW'], RW: ['RW'], ST: ['ST'],
  };

  /* Coordonnées (%) des 11 slots — dupliquées depuis style.css
   * (.dreamteam-slot[data-slot="..."]) pour tracer les liens de chimie
   * sur le SVG superposé (viewBox 0 0 100 100, preserveAspectRatio="none"
   * pour correspondre exactement au positionnement en % du CSS). */
  var SLOT_COORDS = {
    GK: [50, 92], LB: [15, 74], CB1: [38, 78], CB2: [62, 78], RB: [85, 74],
    CM1: [25, 50], CM2: [50, 48], CM3: [75, 50],
    LW: [15, 22], ST: [50, 14], RW: [85, 22],
  };
  /* Desktop (terrain paysage, buts gauche/droite) — mêmes valeurs que
   * la surcharge CSS @media (min-width:860px) de play-hub.css, pour
   * que les liens de chimie (dessinés en JS) restent alignés sur les
   * slots réellement affichés. */
  var SLOT_COORDS_DESKTOP = {
    GK: [8, 50], LB: [25, 18], CB1: [18, 38], CB2: [18, 62], RB: [25, 82],
    CM1: [50, 25], CM2: [50, 50], CM3: [50, 75],
    LW: [76, 18], ST: [90, 50], RW: [76, 82],
  };
  var desktopMedia = window.matchMedia('(min-width:860px)');

  var LEGENDARY_RARITIES = ['legendary', 'mythic', 'limited-edition', 'event-exclusive'];

  function rarityIsLegendary(rarity) {
    return LEGENDARY_RARITIES.indexOf(rarityClass(rarity).replace('rarity-', '')) !== -1;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }
  function rarityClass(rarity) {
    return 'rarity-' + (rarity || 'common').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }
  function ratingBadge(c) {
    if (!c.rating || !c.position) return '';
    return '<div class="shop-card-rating"><span class="shop-card-rating-value">' + escapeHtml(c.rating) +
      '</span><span class="shop-card-rating-pos">' + escapeHtml(c.position) + '</span></div>';
  }

  var queryUid = new URLSearchParams(window.location.search).get('u');
  var currentUser = null;
  var allCards = [];
  var cardsBySlug = {};
  var ownedSlugs = [];
  var ownedSlugsLoaded = false;
  var teamData = { formation: '4-3-3', slots: {} };
  var editable = false;
  var targetUid = null;
  var unsubscribeTeam = null;
  var activeSlotId = null;
  var myNicknamePromise = null;

  function loadCardsIndex() {
    return fetch(root + 'static/data/cards.json').then(function (r) { return r.json(); }).catch(function () { return []; });
  }

  function computeValue(slots) {
    var total = 0;
    Object.keys(slots || {}).forEach(function (slotId) {
      total += cardValue(cardsBySlug[slots[slotId]]);
    });
    return total;
  }

  /* ---------- Stats dérivées (panneau AAA) — calculées uniquement à
   * partir des données réelles déjà chargées (cards.json + slots),
   * jamais de valeur inventée. ---------- */
  function filledCards(slots) {
    var out = [];
    Object.keys(slots || {}).forEach(function (slotId) {
      var c = cardsBySlug[slots[slotId]];
      if (c) out.push(c);
    });
    return out;
  }

  function computeOverall(slots) {
    var cards = filledCards(slots);
    if (!cards.length) return null;
    var sum = cards.reduce(function (s, c) { return s + (c.rating || 0); }, 0);
    return Math.round(sum / cards.length);
  }

  function computeLegendaryCount(slots) {
    return filledCards(slots).filter(function (c) { return rarityIsLegendary(c.rarity); }).length;
  }

  /* Chimie = proportion de paires de titulaires partageant la même
   * sélection nationale (seule donnée de regroupement réelle dispo dans
   * cards.json). 0 ou 1 titulaire => pas de paire possible => null. */
  function computeChemistryPairs(slots) {
    var entries = Object.keys(slots || {}).map(function (slotId) {
      return { slotId: slotId, card: cardsBySlug[slots[slotId]] };
    }).filter(function (e) { return !!e.card; });
    var pairs = [];
    for (var i = 0; i < entries.length; i++) {
      for (var j = i + 1; j < entries.length; j++) {
        if (entries[i].card.collection && entries[i].card.collection === entries[j].card.collection) {
          pairs.push([entries[i].slotId, entries[j].slotId]);
        }
      }
    }
    var possible = entries.length > 1 ? (entries.length * (entries.length - 1)) / 2 : 0;
    return { pairs: pairs, percent: possible ? Math.round(pairs.length / possible * 100) : null };
  }

  /* Pseudo dénormalisé sur le document dreamTeams (même principe que
   * leaderboard.nickname, voir quiz-leaderboard.js) — évite une lecture
   * supplémentaire pour chaque ligne du classement. Résolu une seule fois
   * par chargement de page. */
  function getMyNickname() {
    if (myNicknamePromise) return myNicknamePromise;
    myNicknamePromise = ensureFirestore().then(function (ok) {
      if (!ok || !currentUser) return 'Joueur';
      var refs = getFirestoreRefs();
      var ref = refs.firestoreFns.doc(refs.db, 'users', currentUser.uid);
      return refs.firestoreFns.getDoc(ref).then(function (snap) {
        var data = snap.exists() ? snap.data() : {};
        return data.nickname || currentUser.displayName || (currentUser.email || 'Joueur').split('@')[0];
      }).catch(function () { return 'Joueur'; });
    });
    return myNicknamePromise;
  }

  function renderRanking() {
    var listEl = document.getElementById('dreamteam-ranking-list');
    if (!listEl) return;
    ensureFirestore().then(function (ok) {
      if (!ok) return;
      var refs = getFirestoreRefs();
      loadTopDreamTeams(refs.db, refs.firestoreFns, 20).then(function (rows) {
        rows = rows.filter(function (r) { return r.value > 0; });
        if (!rows.length) return;
        listEl.innerHTML = rows.map(function (r, i) {
          return '<a class="quiz-leaderboard-row" href="' + root + 'play.html?tab=dreamteam&u=' + encodeURIComponent(r.uid) + '">' +
            '<span class="quiz-leaderboard-rank">' + (i + 1) + '</span>' +
            '<span class="quiz-leaderboard-name">' + escapeHtml(r.nickname || 'Joueur') + '</span>' +
            '<span class="quiz-leaderboard-points">' + r.value + '</span></a>';
        }).join('');
      });
    });
  }

  var prevSlots = {};
  var pitchRenderedOnce = false;

  function renderPitch() {
    Array.prototype.forEach.call(pitch.querySelectorAll('.dreamteam-slot'), function (btn) {
      var slotId = btn.getAttribute('data-slot');
      var cardSlug = teamData.slots && teamData.slots[slotId];
      var card = cardSlug && cardsBySlug[cardSlug];
      var justFilled = pitchRenderedOnce && cardSlug && cardSlug !== prevSlots[slotId];
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
      if (justFilled) {
        btn.classList.add('is-just-filled');
        document.dispatchEvent(new CustomEvent('dreamteam-card-added', { detail: { slotId: slotId } }));
        setTimeout(function () { btn.classList.remove('is-just-filled'); }, 550);
      }
    });
    prevSlots = Object.assign({}, teamData.slots || {});
    pitchRenderedOnce = true;
    renderStats();
    renderChemistry();
    renderCoach();
  }

  var lastFilledCount = 0;

  function renderStats() {
    if (!statOverall) return;
    var slots = teamData.slots || {};
    var filledCount = filledCards(slots).length;
    var overall = computeOverall(slots);
    var chem = computeChemistryPairs(slots);

    statOverall.textContent = overall === null ? '–' : overall;
    statValue.textContent = computeValue(slots);
    statCards.textContent = filledCount + '/11';
    statLegendary.textContent = computeLegendaryCount(slots);

    statChemistry.textContent = chem.percent === null ? '–' : chem.percent + '%';
    statChemistry.classList.remove('is-chem-low', 'is-chem-mid', 'is-chem-high');
    if (chem.percent !== null) {
      statChemistry.classList.add(chem.percent < 34 ? 'is-chem-low' : chem.percent < 67 ? 'is-chem-mid' : 'is-chem-high');
    }

    if (filledCount === 11 && lastFilledCount < 11) {
      document.dispatchEvent(new CustomEvent('dreamteam-team-complete'));
    }
    lastFilledCount = filledCount;
  }

  function renderChemistry() {
    if (!chemistrySvg) return;
    Array.prototype.forEach.call(chemistrySvg.querySelectorAll('.dreamteam-chemistry-link'), function (el) { el.remove(); });
    var chem = computeChemistryPairs(teamData.slots || {});
    var tierClass = chem.percent === null ? 'is-chem-mid' : chem.percent < 34 ? 'is-chem-low' : chem.percent < 67 ? 'is-chem-mid' : 'is-chem-high';
    var coords = desktopMedia.matches ? SLOT_COORDS_DESKTOP : SLOT_COORDS;
    var svgNS = 'http://www.w3.org/2000/svg';
    chem.pairs.forEach(function (pair) {
      var a = coords[pair[0]], b = coords[pair[1]];
      if (!a || !b) return;
      var line = document.createElementNS(svgNS, 'line');
      line.setAttribute('class', 'dreamteam-chemistry-link ' + tierClass);
      line.setAttribute('x1', a[0]); line.setAttribute('y1', a[1]);
      line.setAttribute('x2', b[0]); line.setAttribute('y2', b[1]);
      chemistrySvg.appendChild(line);
    });
  }
  if (desktopMedia.addEventListener) desktopMedia.addEventListener('change', renderChemistry);
  else if (desktopMedia.addListener) desktopMedia.addListener(renderChemistry);

  /* ---------- Coach — même carte de sélection que les joueurs, mais
   * un seul champ dénormalisé (coachSlug) sur le document dreamTeams
   * déjà existant. Le roster (nom/nation/formation/rareté/bonus) est
   * rendu côté serveur une seule fois dans la modale (generator.py
   * COACHES) — on lit ces données déjà en DOM plutôt que de les
   * dupliquer en JS. "Formation" et "bonus" restent des attributs
   * d'affichage : aucune incidence sur la formation réelle (4-3-3,
   * inchangée) ni sur le calcul de chimie. ---------- */
  var prevCoachSlug;
  var coachRenderedOnce = false;

  function renderCoach() {
    if (!coachCard) return;
    coachCard.disabled = !editable;
    var slug = teamData.coachSlug;
    var source = slug && coachPickerGrid && coachPickerGrid.querySelector('[data-coach-slug="' + slug + '"]');
    if (!source) {
      coachCard.classList.add('is-empty');
      coachCard.innerHTML = '<span class="dreamteam-coach-placeholder-icon">👔</span>' +
        '<span class="dreamteam-coach-placeholder-text">' + (editable ? 'Choisir un Coach' : 'Aucun coach') + '</span>';
    } else {
      var imgEl = source.querySelector('img');
      var rarityEl = source.querySelector('.shop-card-rarity');
      var name = source.querySelector('h3').textContent;
      var meta = source.querySelector('.dreamteam-coach-picker-meta').textContent;
      var rarityClass2 = rarityEl ? rarityEl.className.replace('shop-card-rarity', '').trim() : '';
      coachCard.classList.remove('is-empty');
      coachCard.innerHTML =
        '<div class="dreamteam-coach-media"><img src="' + imgEl.src + '" alt="' + escapeHtml(name) + '">' +
        '<span class="dreamteam-coach-rarity ' + rarityClass2 + '">' + escapeHtml(rarityEl ? rarityEl.textContent : '') + '</span></div>' +
        '<div class="dreamteam-coach-body"><h3 class="dreamteam-coach-name">' + escapeHtml(name) + '</h3>' +
        '<p class="dreamteam-coach-meta"><span>' + escapeHtml(meta) + '</span></p></div>';
    }
    if (coachRenderedOnce && slug && slug !== prevCoachSlug) {
      document.dispatchEvent(new CustomEvent('dreamteam-coach-added'));
    }
    prevCoachSlug = slug;
    coachRenderedOnce = true;
  }

  function assignCoach(coachSlug) {
    if (!editable || !currentUser) return;
    Promise.all([ensureFirestore().then(function () { return ensureTeamDoc(currentUser.uid); }), getMyNickname()])
      .then(function (results) {
        var ref = results[0];
        var nickname = results[1];
        var refs = getFirestoreRefs();
        return refs.firestoreFns.updateDoc(ref, {
          coachSlug: coachSlug, nickname: nickname, updatedAt: refs.firestoreFns.serverTimestamp(),
        });
      }).catch(function (e) { console.error('Échec sauvegarde du coach Dream Team:', e); });
  }

  function openCoachPicker() {
    if (!editable || !coachPickerModal) return;
    coachPickerModal.hidden = false;
    requestAnimationFrame(function () { coachPickerModal.classList.add('is-open'); });
    document.body.classList.add('drawer-open');
  }
  function closeCoachPicker() {
    if (!coachPickerModal) return;
    coachPickerModal.classList.remove('is-open');
    document.body.classList.remove('drawer-open');
    setTimeout(function () { coachPickerModal.hidden = true; }, 250);
  }
  if (coachPickerClose) coachPickerClose.addEventListener('click', closeCoachPicker);
  if (coachPickerOverlay) coachPickerOverlay.addEventListener('click', closeCoachPicker);
  if (coachCard) {
    coachCard.addEventListener('click', function () {
      coachCard.classList.add('is-clicked');
      setTimeout(function () { coachCard.classList.remove('is-clicked'); }, 320);
      openCoachPicker();
    });
  }
  if (coachPickerGrid) {
    Array.prototype.forEach.call(coachPickerGrid.querySelectorAll('.dreamteam-coach-picker-card'), function (el) {
      el.addEventListener('click', function () {
        assignCoach(el.getAttribute('data-coach-slug'));
        closeCoachPicker();
      });
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
          ratingBadge(c) +
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
      // nickname/value réels écrits juste après par assignSlot — ce
      // placeholder ne sert qu'à satisfaire la règle Firestore (types).
      return refs.firestoreFns.setDoc(ref, { formation: '4-3-3', slots: {}, value: 0, nickname: '' }).then(function () { return ref; });
    });
  }

  function assignSlot(slotId, cardSlug) {
    if (!editable || !currentUser) return;
    var nextSlots = Object.assign({}, teamData.slots || {});
    nextSlots[slotId] = cardSlug;
    var nextValue = computeValue(nextSlots);
    Promise.all([ensureFirestore().then(function () { return ensureTeamDoc(currentUser.uid); }), getMyNickname()])
      .then(function (results) {
        var ref = results[0];
        var nickname = results[1];
        var refs = getFirestoreRefs();
        var update = {};
        update.formation = '4-3-3';
        update['slots.' + slotId] = cardSlug;
        update.value = nextValue;
        update.nickname = nickname;
        update.updatedAt = refs.firestoreFns.serverTimestamp();
        return refs.firestoreFns.updateDoc(ref, update);
      }).then(function () {
        renderRanking();
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
    if (fieldWrap) fieldWrap.hidden = !targetUid;
    if (collectionBlock) collectionBlock.hidden = !editable;
    if (coachBlock) coachBlock.hidden = !targetUid;
    shareBtn.hidden = !editable;
    ownLink.hidden = !(viewingOther && loggedIn);
    emptyNote.hidden = true;

    if (!targetUid) return;

    teamData = { formation: '4-3-3', slots: {} };
    watchTeam(targetUid);

    if (editable) {
      loadOwnedCardSlugs(currentUser.uid).then(function (slugs) {
        ownedSlugs = slugs;
        ownedSlugsLoaded = true;
        emptyNote.hidden = slugs.length > 0;
        renderCollectionCarousel();
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

  /* ---------- Carrousel de collection : toutes les cartes possédées,
   * scroll horizontal natif + glisser-déposer vers un slot (pointer
   * events, s'appuie sur assignSlot() déjà existant — le clic sur un
   * slot vide reste le chemin principal, inchangé). ---------- */
  function slotAccepts(slotId, position) {
    return (SLOT_POSITIONS[slotId] || []).indexOf(position) !== -1;
  }

  function highlightAcceptingSlots(position, on) {
    if (!pitch) return;
    Array.prototype.forEach.call(pitch.querySelectorAll('.dreamteam-slot'), function (s) {
      var accepts = !!(on && position && slotAccepts(s.getAttribute('data-slot'), position));
      s.classList.toggle('is-accepting', accepts);
      s.classList.toggle('is-rejecting', !!on && !accepts);
    });
  }

  function setupCardDrag(cardEl, cardSlug, cardPosition) {
    var pointerId = null, startX = 0, startY = 0, dragging = false, ghost = null;

    cardEl.addEventListener('pointerdown', function (e) {
      if (!editable || e.button === 2) return;
      pointerId = e.pointerId; startX = e.clientX; startY = e.clientY; dragging = false;
    });

    cardEl.addEventListener('pointermove', function (e) {
      if (pointerId === null || e.pointerId !== pointerId || !editable) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      if (!dragging && Math.sqrt(dx * dx + dy * dy) > 16) {
        dragging = true;
        try { cardEl.setPointerCapture(pointerId); } catch (err) {}
        cardEl.classList.add('is-dragging-card');
        ghost = cardEl.cloneNode(true);
        ghost.className = 'dreamteam-drag-ghost';
        ghost.style.cssText = 'position:fixed;z-index:999;pointer-events:none;width:112px;opacity:.92;left:0;top:0;';
        document.body.appendChild(ghost);
        highlightAcceptingSlots(cardPosition, true);
      }
      if (dragging && ghost) {
        ghost.style.transform = 'translate(' + (e.clientX - 56) + 'px,' + (e.clientY - 70) + 'px)';
        var el = document.elementFromPoint(e.clientX, e.clientY);
        var slotEl = el && el.closest && el.closest('.dreamteam-slot');
        Array.prototype.forEach.call(document.querySelectorAll('.dreamteam-slot.is-drop-target'), function (s) {
          s.classList.remove('is-drop-target');
        });
        if (slotEl && slotAccepts(slotEl.getAttribute('data-slot'), cardPosition)) {
          slotEl.classList.add('is-drop-target');
        }
      }
    });

    function endDrag(e) {
      if (pointerId === null) return;
      if (dragging) {
        var el = document.elementFromPoint(e.clientX, e.clientY);
        var slotEl = el && el.closest && el.closest('.dreamteam-slot');
        if (slotEl && slotAccepts(slotEl.getAttribute('data-slot'), cardPosition)) {
          assignSlot(slotEl.getAttribute('data-slot'), cardSlug);
        }
        cardEl.classList.remove('is-dragging-card');
        if (ghost) { ghost.remove(); ghost = null; }
        highlightAcceptingSlots(null, false);
        Array.prototype.forEach.call(document.querySelectorAll('.dreamteam-slot.is-drop-target'), function (s) {
          s.classList.remove('is-drop-target');
        });
      }
      pointerId = null; dragging = false;
    }
    cardEl.addEventListener('pointerup', endDrag);
    cardEl.addEventListener('pointercancel', endDrag);
  }

  function renderCollectionCarousel() {
    if (!carousel) return;
    if (!allCards.length || !ownedSlugsLoaded) return;
    if (!ownedSlugs.length) {
      carousel.innerHTML = '<p class="dreamteam-collection-empty">Aucune carte possédée pour l\'instant.</p>';
      return;
    }
    var owned = ownedSlugs.map(function (slug) { return cardsBySlug[slug]; }).filter(Boolean);
    carousel.innerHTML = owned.map(function (c) {
      return '<div class="shop-card dreamteam-collection-card" data-card-slug="' + escapeHtml(c.slug) + '" ' +
        'data-position="' + escapeHtml(c.position || '') + '" tabindex="0">' +
        '<div class="shop-card-media"><img src="' + root + escapeHtml(c.image) + '" alt="' + escapeHtml(c.name || '') + '" loading="lazy">' +
        ratingBadge(c) +
        '<span class="shop-card-rarity ' + rarityClass(c.rarity) + '">' + escapeHtml(c.rarity || '') + '</span></div>' +
        '<div class="shop-card-body"><h3>' + escapeHtml(c.name || '') + '</h3></div>' +
        '<div class="dreamteam-card-preview">' +
        '<span class="dreamteam-card-preview-name">' + escapeHtml(c.name || '') + '</span>' +
        '<span class="dreamteam-card-preview-meta">' +
        '<span>' + escapeHtml(c.position || '') + '</span>' +
        '<span>' + escapeHtml(String(c.rating || '')) + ' OVR</span>' +
        '<span>' + escapeHtml(c.rarity || '') + '</span>' +
        '<span>' + escapeHtml(c.team || '') + '</span>' +
        '</span></div></div>';
    }).join('');
    Array.prototype.forEach.call(carousel.querySelectorAll('.dreamteam-collection-card'), function (el) {
      setupCardDrag(el, el.getAttribute('data-card-slug'), el.getAttribute('data-position'));
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', function () {
      if (!currentUser) return;
      var url = window.location.origin + root + 'play.html?tab=dreamteam&u=' + currentUser.uid;
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

  loadCardsIndex().then(function (cards) {
    allCards = cards;
    cardsBySlug = {};
    cards.forEach(function (c) { cardsBySlug[c.slug] = c; });
    renderPitch();
    renderCollectionCarousel();
  });

  renderRanking();
})();
