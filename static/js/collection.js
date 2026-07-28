/* Atlas Rising — Ma Collection : cartes obtenues via l'ouverture de packs
 * (points/{uid}/openedPacks/*.grantedCards, dédupliquées), recherche +
 * filtre par rareté. */

import { loadOwnedCardSlugs } from './points.js';

(function () {
  var page = document.getElementById('collection-page');
  if (!page) return;

  var root = document.body.getAttribute('data-root') || '';
  var loginGate = document.getElementById('collection-login-gate');
  var content = document.getElementById('collection-content');
  var grid = document.getElementById('collection-grid');
  var searchInput = document.getElementById('collection-search-input');
  var rarityTabs = document.getElementById('collection-rarity-tabs');

  var allCards = [];
  var ownedSlugs = [];
  var state = { query: '', rarity: 'all' };
  var tabsBuilt = false;

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

  function loadCardsIndex() {
    return fetch(root + 'static/data/cards.json').then(function (r) { return r.json(); }).catch(function () { return []; });
  }

  function renderRarityTabs() {
    if (tabsBuilt) return;
    tabsBuilt = true;
    var seen = {};
    var extra = allCards
      .map(function (c) { return c.rarity; })
      .filter(function (r) { if (!r || seen[r]) return false; seen[r] = true; return true; })
      .map(function (r) {
        return '<button type="button" class="filter-tab" data-rarity="' + escapeHtml(r) + '" role="tab" aria-selected="false">' + escapeHtml(r) + '</button>';
      }).join('');
    rarityTabs.insertAdjacentHTML('beforeend', extra);
    Array.prototype.forEach.call(rarityTabs.querySelectorAll('.filter-tab'), function (tab) {
      tab.addEventListener('click', function () {
        Array.prototype.forEach.call(rarityTabs.querySelectorAll('.filter-tab'), function (t) {
          t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('is-active'); tab.setAttribute('aria-selected', 'true');
        state.rarity = tab.getAttribute('data-rarity');
        render();
      });
    });
  }

  function render() {
    var owned = allCards.filter(function (c) { return ownedSlugs.indexOf(c.slug) !== -1; });
    var filtered = owned.filter(function (c) {
      if (state.rarity !== 'all' && c.rarity !== state.rarity) return false;
      if (state.query) {
        var haystack = [c.name, c.team, c.player, c.competition, c.season].filter(Boolean).join(' ').toLowerCase();
        if (haystack.indexOf(state.query) === -1) return false;
      }
      return true;
    });

    if (!filtered.length) {
      grid.innerHTML = '<div class="empty-state"><p class="matches-empty">' +
        (owned.length ? 'Aucune carte ne correspond.' : 'Aucune carte pour l\'instant — ouvre un pack depuis la Boutique.') +
        '</p></div>';
      return;
    }

    grid.innerHTML = filtered.map(function (c) {
      return '<div class="shop-card">' +
        '<div class="shop-card-media"><img src="' + root + escapeHtml(c.image) + '" alt="' + escapeHtml(c.name || '') + '" loading="lazy">' +
        ratingBadge(c) +
        '<span class="shop-card-rarity ' + rarityClass(c.rarity) + '">' + escapeHtml(c.rarity || '') + '</span></div>' +
        '<div class="shop-card-body"><h3>' + escapeHtml(c.name || '') + '</h3>' +
        '<p>' + [c.team, c.competition, c.season].filter(Boolean).map(escapeHtml).join(' · ') + '</p></div></div>';
    }).join('');
  }

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      state.query = searchInput.value.trim().toLowerCase();
      render();
    });
  }

  document.addEventListener('atlas-auth-changed', function (e) {
    var user = e.detail && e.detail.user;
    if (!user) {
      if (loginGate) loginGate.hidden = false;
      if (content) content.hidden = true;
      return;
    }
    if (loginGate) loginGate.hidden = true;
    if (content) content.hidden = false;
    Promise.all([loadCardsIndex(), loadOwnedCardSlugs(user.uid)]).then(function (results) {
      allCards = results[0];
      ownedSlugs = results[1];
      renderRarityTabs();
      render();
    });
  });

  var loginBtn = document.getElementById('collection-login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', function () {
      var toggle = document.getElementById('account-toggle');
      if (toggle) toggle.click();
    });
  }
})();
