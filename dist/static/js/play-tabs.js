/* Atlas Rising — Play : bascule entre les 5 onglets (Quiz Solo / Défi
 * en ligne / Boutique / Collection / Dream Team) au sein d'une seule
 * page. Chaque section garde son propre script (quiz.js,
 * quiz-duel.js, shop.js, collection.js, dream-team.js, etc.)
 * totalement inchangé — ce module ne fait que montrer/masquer les
 * wrappers .play-panel, jamais les éléments internes déjà gérés par
 * ces scripts. */

(function () {
  var tabs = document.querySelectorAll('.play-tab');
  var panels = document.querySelectorAll('.play-panel');
  if (!tabs.length || !panels.length) return;

  var VALID_TABS = ['quiz-solo', 'quiz-duel', 'boutique', 'collection', 'dreamteam'];

  function currentTabFromUrl() {
    var tab = new URLSearchParams(window.location.search).get('tab');
    return VALID_TABS.indexOf(tab) !== -1 ? tab : 'quiz-solo';
  }

  function showTab(tab) {
    panels.forEach(function (panel) {
      panel.hidden = panel.getAttribute('data-tab-panel') !== tab;
    });
    tabs.forEach(function (btn) {
      var active = btn.getAttribute('data-tab') === tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  tabs.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.getAttribute('data-tab');
      showTab(tab);
      var url = new URL(window.location.href);
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url);
    });
  });

  var initial = currentTabFromUrl();
  if (initial !== 'quiz-solo') showTab(initial);
})();
