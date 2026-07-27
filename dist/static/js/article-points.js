/* Atlas Rising — Atlas Points sur la page article : lecture + partage. */

import { awardPoints } from './points.js';

(function () {
  var section = document.getElementById('comments-section');
  if (!section) return;
  var slug = section.getAttribute('data-article-slug');

  function creditRead() {
    if (!slug) return;
    awardPoints('article_read', 'article-' + slug);
  }

  document.addEventListener('atlas-auth-changed', function (e) {
    if (e.detail && e.detail.user) creditRead();
  }, { once: false });

  // Si déjà connecté au chargement de ce script (auth.js a pu émettre
  // l'événement avant que ce module ne soit prêt), tente aussi tout de
  // suite — awardPoints est idempotent (voir points.js), sans risque.
  if (window.AtlasAuth && window.AtlasAuth.isReady() && window.AtlasAuth.getCurrentUser()) {
    creditRead();
  }

  var shareBtn = document.getElementById('article-share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', function () {
      var title = shareBtn.getAttribute('data-title') || document.title;
      var url = window.location.href;
      var afterShare = function () {
        if (slug) awardPoints('content_share', 'share-' + slug + '-' + new Date().toISOString().slice(0, 10));
      };
      if (navigator.share) {
        navigator.share({ title: title, url: url }).then(afterShare).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () {
          shareBtn.textContent = 'Lien copié !';
          setTimeout(function () {
            shareBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.6l6.8-3.8M8.6 13.4l6.8 3.8"/></svg> Partager';
          }, 2000);
          afterShare();
        }).catch(function () {});
      }
    });
  }
})();
