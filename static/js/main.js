/* Atlas Rising — interactions minimales (vanilla JS, pas de dépendance) */

document.addEventListener('DOMContentLoaded', function () {

  /* --- Menu mobile --- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    nav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* --- Recherche instantanée (index JSON généré par generator.py) --- */
  var searchToggle = document.getElementById('search-toggle');
  var searchOverlay = document.getElementById('search-overlay');
  var searchClose = document.getElementById('search-close');
  var searchInput = document.getElementById('search-input');
  var searchResults = document.getElementById('search-results');
  var root = document.body.getAttribute('data-root') || '';
  var searchIndex = null;
  var searchIndexPromise = null;

  function loadSearchIndex() {
    if (!searchIndexPromise) {
      searchIndexPromise = fetch(root + 'static/search-index.json')
        .then(function (r) { return r.json(); })
        .then(function (data) { searchIndex = data; return data; })
        .catch(function () { searchIndex = []; return []; });
    }
    return searchIndexPromise;
  }

  function openSearch() {
    searchOverlay.classList.add('is-open');
    searchOverlay.setAttribute('aria-hidden', 'false');
    searchToggle.setAttribute('aria-expanded', 'true');
    loadSearchIndex();
    setTimeout(function () { searchInput.focus(); }, 50);
  }

  function closeSearch() {
    searchOverlay.classList.remove('is-open');
    searchOverlay.setAttribute('aria-hidden', 'true');
    searchToggle.setAttribute('aria-expanded', 'false');
  }

  function renderResults(query) {
    var q = query.trim().toLowerCase();
    if (!q) {
      searchResults.innerHTML = '';
      return;
    }
    var matches = (searchIndex || []).filter(function (a) {
      var haystack = (a.title + ' ' + a.dek + ' ' + a.category + ' ' + (a.tags || []).join(' ')).toLowerCase();
      return haystack.indexOf(q) !== -1;
    }).slice(0, 8);

    if (matches.length === 0) {
      searchResults.innerHTML = '<div class="search-empty">Aucun article trouvé pour "' + query + '".</div>';
      return;
    }

    searchResults.innerHTML = matches.map(function (a) {
      return '<a class="search-result" href="' + root + a.url + '">' +
        '<span class="search-result-category">' + a.category + '</span>' +
        '<span class="search-result-title">' + a.title + '</span>' +
        '</a>';
    }).join('');
  }

  if (searchToggle && searchOverlay) {
    searchToggle.addEventListener('click', openSearch);
    searchClose.addEventListener('click', closeSearch);

    searchOverlay.addEventListener('click', function (e) {
      if (e.target === searchOverlay) closeSearch();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && searchOverlay.classList.contains('is-open')) closeSearch();
    });

    searchInput.addEventListener('input', function () {
      loadSearchIndex().then(function () { renderResults(searchInput.value); });
    });
  }

  /* --- Formulaires newsletter (inscription via Brevo, proxée par une Netlify Function) --- */
  var forms = document.querySelectorAll('[data-newsletter]');
  forms.forEach(function (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var button = form.querySelector('button');
      var input = form.querySelector('input[type="email"]');
      var email = input ? input.value.trim() : '';
      if (!email) return;

      var original = button.textContent;
      button.disabled = true;
      button.textContent = 'Envoi...';

      fetch('/.netlify/functions/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email }),
      })
        .then(function (r) { return r.json().then(function (data) { return { ok: r.ok, data: data }; }); })
        .then(function (result) {
          if (result.ok) {
            button.textContent = 'Merci !';
            form.reset();
          } else {
            button.textContent = 'Erreur, réessayez';
          }
        })
        .catch(function () {
          button.textContent = 'Erreur, réessayez';
        })
        .finally(function () {
          setTimeout(function () {
            button.textContent = original;
            button.disabled = false;
          }, 3000);
        });
    });
  });

});
