/* Atlas Rising — Boutique Atlas Points (packs + badges/avatars/cadres/
 * cosmétiques + inventaire). L'ouverture des packs est déléguée à
 * pack-opening.js (déclenchée via un événement custom pour rester
 * découplée). */

import { firebaseConfigured, firebaseAppPromise } from './firebase-config.js';
import { ensureFirestore, getFirestoreRefs, watchPoints, buyItem, buyPack, loadOpenedPackIds, equip } from './points.js';

(function () {
  var page = document.getElementById('shop-page');
  if (!page) return;

  var root = document.body.getAttribute('data-root') || '';
  var loginGate = document.getElementById('shop-login-gate');
  var balanceDisplay = document.getElementById('shop-balance-display');
  var balanceValue = document.getElementById('shop-balance-value');
  var packsGrid = document.getElementById('shop-packs-grid');
  var itemsGrid = document.getElementById('shop-items-grid');
  var inventorySection = document.getElementById('shop-inventory-section');
  var inventoryEl = document.getElementById('shop-inventory');

  var currentUser = null;
  var currentBalance = 0;
  var pointsData = { ownedPacks: {}, ownedItems: {} };
  var packsCatalog = [];
  var shopItems = [];
  var openedPackIds = [];

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function rarityClass(rarity) {
    return 'rarity-' + (rarity || 'common').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function loadPacksCatalog() {
    return fetch(root + 'static/data/packs.json').then(function (r) { return r.json(); }).catch(function () { return []; });
  }

  function loadShopItems() {
    return ensureFirestore().then(function (ok) {
      if (!ok) return [];
      var refs = getFirestoreRefs();
      var q = refs.firestoreFns.collection(refs.db, 'shop');
      return refs.firestoreFns.getDocs(q).then(function (snap) {
        var items = [];
        snap.forEach(function (d) { items.push(Object.assign({ id: d.id }, d.data())); });
        return items;
      }).catch(function () { return []; });
    });
  }

  function statusLabel(status) {
    if (status === 'soldout') return 'Épuisé';
    if (status === 'comingsoon') return 'Bientôt disponible';
    return 'Disponible';
  }

  var EQUIP_SLOTS = { badge: 'equippedBadge', avatar: 'equippedAvatar', frame: 'equippedFrame', cadre: 'equippedFrame' };

  function slotFor(item) {
    return EQUIP_SLOTS[(item.type || '').toLowerCase()] || null;
  }

  function renderPacks() {
    if (!packsCatalog.length) {
      packsGrid.innerHTML = '<div class="empty-state"><p class="matches-empty">Aucun pack disponible pour l\'instant — revenez bientôt.</p></div>';
      return;
    }
    packsGrid.innerHTML = packsCatalog.map(function (p) {
      var canAfford = currentUser && currentBalance >= p.price;
      return '<div class="shop-card">' +
        '<div class="shop-card-media"><img src="' + root + escapeHtml(p.image) + '" alt="' + escapeHtml(p.name) + '" loading="lazy">' +
        '<span class="shop-card-rarity ' + rarityClass(p.rarity) + '">' + escapeHtml(p.rarity || '') + '</span></div>' +
        '<div class="shop-card-body"><h3>' + escapeHtml(p.name) + '</h3><p>' + escapeHtml(p.description || '') + '</p>' +
        '<button type="button" class="shop-buy-btn" data-type="pack" data-slug="' + escapeHtml(p.slug) + '" data-price="' + p.price + '"' +
        (canAfford ? '' : ' disabled') + '>' +
        '<span class="points-badge-icon" aria-hidden="true">⭐</span> ' + p.price + '</button></div></div>';
    }).join('');

    Array.prototype.forEach.call(packsGrid.querySelectorAll('.shop-buy-btn'), function (btn) {
      btn.addEventListener('click', function () { handleBuyPack(btn); });
    });
  }

  function renderItems() {
    if (!shopItems.length) {
      itemsGrid.innerHTML = '<div class="empty-state"><p class="matches-empty">Aucun article disponible pour l\'instant.</p></div>';
      return;
    }
    itemsGrid.innerHTML = shopItems.map(function (it) {
      var owned = pointsData.ownedItems && pointsData.ownedItems[it.id];
      var canAfford = currentUser && !owned && it.status === 'available' && currentBalance >= it.price;
      var slot = slotFor(it);
      var equipped = owned && slot && pointsData[slot] === it.id;
      var actionBtn;
      if (owned && slot) {
        actionBtn = '<button type="button" class="shop-buy-btn shop-equip-btn' + (equipped ? ' is-equipped' : '') + '" data-slot="' + slot + '" data-slug="' + escapeHtml(it.id) + '">' +
          (equipped ? 'Équipé ✓' : 'Équiper') + '</button>';
      } else if (owned) {
        actionBtn = '<button type="button" class="shop-buy-btn" disabled>Possédé</button>';
      } else {
        actionBtn = '<button type="button" class="shop-buy-btn" data-type="item" data-slug="' + escapeHtml(it.id) + '" data-price="' + it.price + '"' +
          (canAfford ? '' : ' disabled') + '>⭐ ' + it.price + '</button>';
      }
      return '<div class="shop-card">' +
        '<div class="shop-card-media"><img src="' + escapeHtml(it.imageUrl || '') + '" alt="' + escapeHtml(it.name) + '" loading="lazy">' +
        '<span class="shop-card-rarity ' + rarityClass(it.rarity) + '">' + escapeHtml(it.rarity || '') + '</span></div>' +
        '<div class="shop-card-body"><h3>' + escapeHtml(it.name) + '</h3>' +
        '<p class="shop-card-status">' + (owned ? 'Possédé' : escapeHtml(statusLabel(it.status))) + '</p>' +
        actionBtn + '</div></div>';
    }).join('');

    Array.prototype.forEach.call(itemsGrid.querySelectorAll('.shop-equip-btn'), function (btn) {
      btn.addEventListener('click', function () { handleEquip(btn); });
    });
    Array.prototype.forEach.call(itemsGrid.querySelectorAll('.shop-buy-btn[data-type="item"]'), function (btn) {
      btn.addEventListener('click', function () { handleBuyItem(btn); });
    });
  }

  function handleEquip(btn) {
    if (!currentUser) return;
    var slot = btn.getAttribute('data-slot');
    var itemId = btn.getAttribute('data-slug');
    if (btn.classList.contains('is-equipped')) return;
    btn.disabled = true;
    equip(slot, itemId).catch(function (e) {
      console.error('Échec équipement:', e);
    }).then(function () { btn.disabled = false; });
  }

  function renderInventory() {
    var owned = pointsData.ownedPacks || {};
    var keys = Object.keys(owned).filter(function (id) { return openedPackIds.indexOf(id) === -1; });
    if (!currentUser) { inventorySection.hidden = true; return; }
    inventorySection.hidden = false;
    if (!keys.length) {
      inventoryEl.innerHTML = '<p class="matches-empty">Aucun pack en attente d\'ouverture.</p>';
      return;
    }
    inventoryEl.innerHTML = keys.map(function (instanceId) {
      var entry = owned[instanceId];
      var pack = packsCatalog.filter(function (p) { return p.slug === entry.packSlug; })[0];
      var name = pack ? pack.name : entry.packSlug;
      var image = pack ? (root + pack.image) : '';
      return '<div class="shop-inventory-item">' +
        (image ? '<img src="' + escapeHtml(image) + '" alt="" class="shop-inventory-thumb">' : '') +
        '<span class="shop-inventory-name">' + escapeHtml(name) + '</span>' +
        '<button type="button" class="quiz-btn-primary shop-open-btn" data-instance-id="' + escapeHtml(instanceId) + '" data-pack-slug="' + escapeHtml(entry.packSlug) + '">Ouvrir</button>' +
        '</div>';
    }).join('');

    Array.prototype.forEach.call(inventoryEl.querySelectorAll('.shop-open-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var pack = packsCatalog.filter(function (p) { return p.slug === btn.getAttribute('data-pack-slug'); })[0];
        document.dispatchEvent(new CustomEvent('atlas-open-pack', {
          detail: { instanceId: btn.getAttribute('data-instance-id'), pack: pack },
        }));
      });
    });
  }

  function handleBuyPack(btn) {
    if (!currentUser) return;
    var slug = btn.getAttribute('data-slug');
    var price = parseInt(btn.getAttribute('data-price'), 10);
    btn.disabled = true;
    buyPack(slug, price).catch(function (e) {
      console.error('Échec achat pack:', e);
      btn.disabled = false;
    });
  }

  function handleBuyItem(btn) {
    if (!currentUser) return;
    var slug = btn.getAttribute('data-slug');
    var price = parseInt(btn.getAttribute('data-price'), 10);
    btn.disabled = true;
    buyItem(slug, price).catch(function (e) {
      console.error('Échec achat article:', e);
      btn.disabled = false;
    });
  }

  function refreshAll() {
    renderPacks();
    renderItems();
    renderInventory();
  }

  var unsubscribe = null;
  function onAuthChanged(user) {
    currentUser = user;
    if (loginGate) loginGate.hidden = !!user;
    if (balanceDisplay) balanceDisplay.hidden = !user;
    if (!user) {
      currentBalance = 0;
      pointsData = { ownedPacks: {}, ownedItems: {} };
      openedPackIds = [];
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      refreshAll();
      return;
    }
    if (unsubscribe) unsubscribe();
    loadOpenedPackIds(user.uid).then(function (ids) { openedPackIds = ids; renderInventory(); });
    watchPoints(user.uid, function (data) {
      pointsData = data || { ownedPacks: {}, ownedItems: {} };
      currentBalance = pointsData.balance || 0;
      if (balanceValue) balanceValue.textContent = currentBalance;
      refreshAll();
    }).then(function (unsub) { unsubscribe = unsub; });
  }

  document.addEventListener('atlas-auth-changed', function (e) {
    onAuthChanged(e.detail && e.detail.user);
  });

  document.addEventListener('atlas-pack-opened', function (e) {
    if (e.detail && e.detail.instanceId) openedPackIds.push(e.detail.instanceId);
    renderInventory();
  });

  var loginBtn = document.getElementById('shop-login-btn');
  if (loginBtn) {
    loginBtn.addEventListener('click', function () {
      var toggle = document.getElementById('account-toggle');
      if (toggle) toggle.click();
    });
  }

  Promise.all([loadPacksCatalog(), loadShopItems()]).then(function (results) {
    packsCatalog = results[0];
    shopItems = results[1];
    refreshAll();
  });
})();
