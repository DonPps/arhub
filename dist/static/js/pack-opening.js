/* Atlas Rising — ouverture d'un pack de cartes (révélation animée).
 * Déclenchée par l'événement custom "atlas-open-pack" (voir shop.js).
 * Le tirage aléatoire se fait ici, côté client (pas de fonction serveur
 * dans cette passe — voir plan) ; le résultat est validé par
 * firestore.rules (cartes issues du pool légitime du pack, bonne
 * quantité, une seule ouverture par instance). */

import { openPack } from './points.js';

(function () {
  var modal = document.getElementById('pack-opening-modal');
  var overlay = document.getElementById('pack-opening-overlay');
  var closeBtn = document.getElementById('pack-opening-close');
  var body = document.getElementById('pack-opening-body');
  if (!modal) return;

  var root = document.body.getAttribute('data-root') || '';
  var cardsIndexPromise = null;

  function loadCardsIndex() {
    if (!cardsIndexPromise) {
      cardsIndexPromise = fetch(root + 'static/data/cards.json').then(function (r) { return r.json(); }).catch(function () { return []; });
    }
    return cardsIndexPromise;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function rarityClass(rarity) {
    return 'rarity-' + (rarity || 'common').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function pickRandomCards(pool, count) {
    var shuffled = pool.slice().sort(function () { return Math.random() - 0.5; });
    return shuffled.slice(0, count);
  }

  function openModal() {
    modal.hidden = false;
    requestAnimationFrame(function () { modal.classList.add('is-open'); });
    document.body.classList.add('drawer-open');
  }
  function closeModal() {
    modal.classList.remove('is-open');
    document.body.classList.remove('drawer-open');
    setTimeout(function () { modal.hidden = true; }, 250);
  }
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (overlay) overlay.addEventListener('click', closeModal);

  function revealCards(cards) {
    if (!cards.length) {
      body.innerHTML = '<p class="pack-opening-loading">Ce pack ne contient aucune carte pour l\'instant.</p>';
      return;
    }
    body.innerHTML = '<h2 class="pack-reveal-title">Nouvelles cartes !</h2><div class="pack-reveal-grid">' +
      cards.map(function (c, i) {
        return '<div class="pack-reveal-card ' + rarityClass(c.rarity) + '" style="animation-delay:' + (i * 0.15) + 's">' +
          '<img src="' + root + escapeHtml(c.image) + '" alt="' + escapeHtml(c.name || '') + '">' +
          '<div class="pack-reveal-card-name">' + escapeHtml(c.name || '') + '</div>' +
          '<div class="pack-reveal-card-rarity">' + escapeHtml(c.rarity || '') + '</div>' +
          '</div>';
      }).join('') + '</div>';
  }

  document.addEventListener('atlas-open-pack', function (e) {
    var instanceId = e.detail && e.detail.instanceId;
    var pack = e.detail && e.detail.pack;
    if (!instanceId || !pack) return;

    body.innerHTML = '<p class="pack-opening-loading">Ouverture du pack…</p>';
    openModal();

    loadCardsIndex().then(function (allCards) {
      var pool = allCards.filter(function (c) { return (pack.cardPool || []).indexOf(c.slug) !== -1; });
      var count = pack.cardsPerPack || Math.min(5, pool.length);
      var picked = pickRandomCards(pool, count);
      var pickedSlugs = picked.map(function (c) { return c.slug; });

      return openPack(instanceId, pack.slug, pickedSlugs).then(function () {
        revealCards(picked);
        document.dispatchEvent(new CustomEvent('atlas-pack-opened', { detail: { instanceId: instanceId } }));
      });
    }).catch(function (err) {
      body.innerHTML = '<p class="pack-opening-loading">Erreur lors de l\'ouverture — réessaie.</p>';
      console.error('Échec ouverture pack:', err);
    });
  });
})();
