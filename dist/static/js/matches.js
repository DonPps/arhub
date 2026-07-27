/* Atlas Rising — page Matchs (centre de scores léger, budget API maîtrisé).
 *
 * Architecture (voir plan de refonte pour le détail) :
 *   DateSelector      -> renderDateSelector() / selectDate()
 *   SearchBar         -> écouteur #matches-search-input
 *   FilterTabs        -> écouteur #filter-tabs
 *   CompetitionSection/MatchRow/MatchStatus/MatchScore -> renderGroups() et
 *                        les fonctions render* qu'elle appelle
 *   FavoriteButton    -> renderFavoriteButton() / handleFavoriteClick()
 *   MatchDetailsDrawer-> openDrawer() / closeDrawer()
 *
 * Chaque date est un fichier JSON statique déjà généré par le pipeline
 * (agents/matches_agent.py côté agent) — changer de date ne coûte jamais
 * un appel à l'API football, juste un fetch() de notre propre fichier.
 * Le "live" est une actualisation périodique de ce même fichier (45s),
 * pas un flux temps réel — la fraîcheur réelle dépend de la fréquence du
 * pipeline (voir agents/matches_agent.py).
 */

import { firebaseConfigured, firebaseAppPromise } from './firebase-config.js';
import { loadFavorites, toggleFavorite } from './favorites.js';

(function () {
  var page = document.getElementById('matches-page');
  if (!page) return;

  var root = document.body.getAttribute('data-root') || '';
  var todayStr = page.getAttribute('data-today');

  var dateSelectorEl = document.getElementById('date-selector');
  var calendarBtn = document.getElementById('date-calendar-btn');
  var calendarInput = document.getElementById('date-calendar-input');
  var searchInput = document.getElementById('matches-search-input');
  var filterTabsEl = document.getElementById('filter-tabs');
  var groupsEl = document.getElementById('matches-groups');
  var updatedEl = document.getElementById('matches-updated');
  var drawer = document.getElementById('match-drawer');
  var drawerBody = document.getElementById('match-drawer-body');
  var drawerClose = document.getElementById('match-drawer-close');
  var drawerOverlay = document.getElementById('match-drawer-overlay');

  var state = {
    date: todayStr,
    matches: [],
    filter: 'all',
    query: '',
    favorites: { teams: [], competitions: [] },
  };

  var db = null, firestoreFns = null, currentUser = null;
  var liveTimer = null;
  var searchIndexPromise = null;

  /* ---------- Dates ---------- */
  function parseDateStr(str) {
    var parts = str.split('-').map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  }
  function formatDateStr(d) { return d.toISOString().slice(0, 10); }
  function addDays(str, n) {
    var d = parseDateStr(str);
    d.setUTCDate(d.getUTCDate() + n);
    return formatDateStr(d);
  }
  function dateLabel(str) {
    if (str === todayStr) return "Aujourd'hui";
    if (str === addDays(todayStr, -1)) return 'Hier';
    if (str === addDays(todayStr, 1)) return 'Demain';
    var d = parseDateStr(str);
    return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  }

  /* L'heure locale n'est PAS précalculée dans les fichiers archivés (ils
   * viennent tels quels du pipeline, sans passer par generator.py) — on
   * la calcule ici, dans le fuseau du Maroc pour rester cohérent quel
   * que soit le fuseau du visiteur. */
  function formatKickoffLocal(isoUtc) {
    if (!isoUtc) return '';
    var d = new Date(isoUtc);
    if (isNaN(d.getTime())) return '';
    try {
      return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Casablanca' }).format(d);
    } catch (e) {
      return d.toISOString().slice(11, 16);
    }
  }

  /* ---------- DateSelector ---------- */
  function renderDateSelector() {
    // Le plan API-Football actuel ne couvre que J-1 à J+1 (voir
    // agents/matches_agent.py) — le bouton calendrier reste le seul
    // moyen d'atteindre une date plus ancienne déjà archivée.
    var days = [];
    for (var i = -1; i <= 1; i++) days.push(addDays(todayStr, i));
    if (days.indexOf(state.date) === -1) days.push(state.date);

    dateSelectorEl.innerHTML = days.map(function (d) {
      var active = d === state.date ? ' is-active' : '';
      return '<button type="button" class="date-tab' + active + '" data-date="' + d + '" role="tab" aria-selected="' + (d === state.date) + '">' + dateLabel(d) + '</button>';
    }).join('');

    Array.prototype.forEach.call(dateSelectorEl.querySelectorAll('.date-tab'), function (btn) {
      btn.addEventListener('click', function () { selectDate(btn.getAttribute('data-date')); });
    });
  }

  function selectDate(dateStr) {
    if (dateStr === state.date) return;
    state.date = dateStr;
    renderDateSelector();
    loadMatches();
  }

  if (calendarBtn && calendarInput) {
    calendarBtn.addEventListener('click', function () {
      calendarInput.value = state.date;
      if (calendarInput.showPicker) {
        try { calendarInput.showPicker(); } catch (e) { calendarInput.focus(); }
      } else {
        calendarInput.focus();
      }
    });
    calendarInput.addEventListener('change', function () {
      if (calendarInput.value) selectDate(calendarInput.value);
    });
  }

  /* ---------- Chargement des matchs ---------- */
  function loadMatches() {
    groupsEl.innerHTML = '<p class="matches-loading">Chargement…</p>';
    stopLivePolling();
    fetchDateJson(state.date).then(function (data) {
      state.matches = (data && data.matches) || [];
      updateUpdatedLabel(data && data.updated_at);
      renderGroups();
      if (state.date === todayStr) startLivePolling();
    });
  }

  function fetchDateJson(dateStr) {
    return fetch(root + 'static/data/matches/' + dateStr + '.json', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('not found'); return r.json(); })
      .catch(function () { return null; });
  }

  function updateUpdatedLabel(updatedAtIso) {
    if (!updatedEl) return;
    if (!updatedAtIso) { updatedEl.hidden = true; return; }
    try {
      var d = new Date(updatedAtIso);
      updatedEl.textContent = 'Mis à jour : ' + d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      updatedEl.hidden = false;
    } catch (e) { updatedEl.hidden = true; }
  }

  function startLivePolling() {
    liveTimer = setInterval(function () {
      fetchDateJson(state.date).then(function (data) {
        if (!data) return;
        state.matches = data.matches || [];
        updateUpdatedLabel(data.updated_at);
        renderGroups();
      });
    }, 45000);
  }
  function stopLivePolling() {
    if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  }

  /* ---------- SearchBar / FilterTabs ---------- */
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      state.query = searchInput.value.trim().toLowerCase();
      renderGroups();
    });
  }
  if (filterTabsEl) {
    Array.prototype.forEach.call(filterTabsEl.querySelectorAll('.filter-tab'), function (tab) {
      tab.addEventListener('click', function () {
        Array.prototype.forEach.call(filterTabsEl.querySelectorAll('.filter-tab'), function (t) {
          t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('is-active'); tab.setAttribute('aria-selected', 'true');
        state.filter = tab.getAttribute('data-filter');
        renderGroups();
      });
    });
  }

  function matchPassesFilter(m) {
    if (state.filter === 'live') return m.status === 'LIVE';
    if (state.filter === 'upcoming') return m.status === 'SCHEDULED';
    if (state.filter === 'finished') return m.status === 'RESULT';
    if (state.filter === 'favorites') {
      return state.favorites.teams.indexOf(m.team_a) !== -1
        || state.favorites.teams.indexOf(m.team_b) !== -1
        || state.favorites.competitions.indexOf(m.competition) !== -1;
    }
    return true;
  }
  function matchPassesSearch(m) {
    if (!state.query) return true;
    var haystack = (m.team_a + ' ' + m.team_b + ' ' + m.competition).toLowerCase();
    return haystack.indexOf(state.query) !== -1;
  }

  /* ---------- Rendu ---------- */
  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  function isCompetitionFavorite(name) { return state.favorites.competitions.indexOf(name) !== -1; }
  function isTeamFavorite(name) { return state.favorites.teams.indexOf(name) !== -1; }

  function renderFavoriteButton(type, name) {
    if (!currentUser) return '';
    var active = (type === 'teams' ? isTeamFavorite(name) : isCompetitionFavorite(name));
    return '<button type="button" class="favorite-btn' + (active ? ' is-active' : '') +
      '" data-favorite-type="' + type + '" data-favorite-name="' + escapeHtml(name) + '" aria-label="' +
      (active ? 'Retirer des favoris' : 'Ajouter aux favoris') + '" aria-pressed="' + active + '">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="' + (active ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M12 17.3L5.8 21l1.6-7L2 9.3l7.1-.6L12 2l2.9 6.7 7.1.6-5.4 4.7 1.6 7z"/></svg></button>';
  }

  function renderCrest(url, name, extraClass) {
    if (url) return '<img src="' + url + '" alt="" class="' + extraClass + '" loading="lazy">';
    var initial = (name || '?').charAt(0).toUpperCase();
    return '<span class="' + extraClass + ' crest-fallback">' + escapeHtml(initial) + '</span>';
  }

  function statusBadge(m) {
    if (m.status === 'LIVE') {
      return '<span class="match-badge match-badge-live">LIVE' + (m.elapsed != null ? ' ' + m.elapsed + "'" : '') + '</span>';
    }
    if (m.status === 'RESULT') {
      var label = 'TERMINÉ';
      if (m.status_short === 'PEN') label = 'TAB';
      else if (m.status_short === 'AET') label = 'AP';
      return '<span class="match-badge match-badge-ended">' + label + '</span>';
    }
    if (m.status === 'OTHER') {
      return '<span class="match-badge match-badge-other">' + escapeHtml(m.status_long || 'INDISPONIBLE') + '</span>';
    }
    return '<span class="match-badge match-badge-scheduled">À VENIR</span>';
  }

  function scoreOrTime(m) {
    if (m.status === 'SCHEDULED') {
      return '<span class="match-row-time">' + escapeHtml(formatKickoffLocal(m.kickoff_utc)) + '</span>';
    }
    if (m.status === 'OTHER') {
      return '<span class="match-row-time">' + escapeHtml(m.status_long || '') + '</span>';
    }
    var html = '<span class="match-row-score">' + (m.score_a != null ? m.score_a : '-') + ' - ' + (m.score_b != null ? m.score_b : '-') + '</span>';
    if (m.status === 'RESULT' && (m.status_short === 'AET' || m.status_short === 'PEN') && m.score_ht_a != null) {
      html += '<span class="match-row-sub">Mi-temps ' + m.score_ht_a + '-' + m.score_ht_b + '</span>';
    }
    if (m.status_short === 'PEN' && m.score_pen_a != null) {
      html += '<span class="match-row-sub">TAB ' + m.score_pen_a + '-' + m.score_pen_b + '</span>';
    }
    return html;
  }

  function renderMatchRow(m) {
    return '<div class="match-row" data-match-id="' + m.id + '" tabindex="0" role="button" aria-label="Voir le détail du match ' + escapeHtml(m.team_a) + ' contre ' + escapeHtml(m.team_b) + '">' +
      '<div class="match-row-team">' + renderCrest(m.team_a_crest, m.team_a, 'match-row-crest') + '<span class="match-row-team-name">' + escapeHtml(m.team_a) + '</span></div>' +
      '<div class="match-row-center">' + statusBadge(m) + scoreOrTime(m) + '</div>' +
      '<div class="match-row-team match-row-team-b"><span class="match-row-team-name">' + escapeHtml(m.team_b) + '</span>' + renderCrest(m.team_b_crest, m.team_b, 'match-row-crest') + '</div>' +
      '</div>';
  }

  function groupMatches(matches) {
    var groups = [];
    var index = {};
    matches.forEach(function (m) {
      if (!index[m.competition]) {
        index[m.competition] = { name: m.competition, logo: m.competition_logo, country: m.competition_country, matches: [] };
        groups.push(index[m.competition]);
      }
      index[m.competition].matches.push(m);
    });
    groups.sort(function (a, b) {
      var aFav = isCompetitionFavorite(a.name) || a.matches.some(function (m) { return isTeamFavorite(m.team_a) || isTeamFavorite(m.team_b); });
      var bFav = isCompetitionFavorite(b.name) || b.matches.some(function (m) { return isTeamFavorite(m.team_a) || isTeamFavorite(m.team_b); });
      if (aFav === bFav) return 0;
      return aFav ? -1 : 1;
    });
    return groups;
  }

  function renderGroups() {
    var filtered = state.matches.filter(function (m) { return matchPassesFilter(m) && matchPassesSearch(m); });

    if (!filtered.length) {
      groupsEl.innerHTML = '<div class="empty-state"><p class="matches-empty">' +
        (state.matches.length ? 'Aucun match ne correspond.' : 'Aucun match dans les grandes compétitions suivies pour cette date.') +
        '</p></div>';
      return;
    }

    var groups = groupMatches(filtered);
    groupsEl.innerHTML = groups.map(function (g) {
      return '<section class="competition-group" data-competition="' + escapeHtml(g.name) + '">' +
        '<button type="button" class="competition-header" aria-expanded="true">' +
        '<span class="competition-header-main">' +
        renderCrest(g.logo, g.name, 'competition-logo') +
        '<span class="competition-name">' + escapeHtml(g.name) + '</span>' +
        (g.country ? '<span class="competition-country">' + escapeHtml(g.country) + '</span>' : '') +
        '</span>' +
        '<span class="competition-header-actions">' +
        renderFavoriteButton('competitions', g.name) +
        '<svg class="competition-chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>' +
        '</span></button>' +
        '<div class="competition-matches">' + g.matches.map(renderMatchRow).join('') + '</div>' +
        '</section>';
    }).join('');

    bindGroupEvents();
  }

  function bindGroupEvents() {
    Array.prototype.forEach.call(groupsEl.querySelectorAll('.competition-header'), function (header) {
      header.addEventListener('click', function (e) {
        if (e.target.closest('.favorite-btn')) return;
        var section = header.closest('.competition-group');
        var expanded = header.getAttribute('aria-expanded') === 'true';
        header.setAttribute('aria-expanded', String(!expanded));
        section.classList.toggle('is-collapsed', expanded);
      });
    });

    Array.prototype.forEach.call(groupsEl.querySelectorAll('.match-row'), function (row) {
      row.addEventListener('click', function () { openDrawer(row.getAttribute('data-match-id')); });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrawer(row.getAttribute('data-match-id')); }
      });
    });

    Array.prototype.forEach.call(groupsEl.querySelectorAll('.favorite-btn'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        handleFavoriteClick(btn);
      });
    });
  }

  function handleFavoriteClick(btn) {
    if (!currentUser || !db) return;
    var type = btn.getAttribute('data-favorite-type');
    var name = btn.getAttribute('data-favorite-name');
    btn.disabled = true;
    toggleFavorite(db, firestoreFns, currentUser.uid, type, name).then(function (isFav) {
      if (isFav) { if (state.favorites[type].indexOf(name) === -1) state.favorites[type].push(name); }
      else { state.favorites[type] = state.favorites[type].filter(function (n) { return n !== name; }); }
      renderGroups();
    }).catch(function (e) {
      console.error('Échec favori:', e);
      btn.disabled = false;
    });
  }

  /* ---------- MatchDetailsDrawer ---------- */
  function loadSearchIndex() {
    if (!searchIndexPromise) {
      searchIndexPromise = fetch(root + 'static/search-index.json').then(function (r) { return r.json(); }).catch(function () { return []; });
    }
    return searchIndexPromise;
  }

  function relatedArticles(m, index) {
    var needles = [m.team_a, m.team_b, m.competition].filter(Boolean).map(function (s) { return s.toLowerCase(); });
    return index.filter(function (a) {
      var haystack = (a.title + ' ' + (a.tags || []).join(' ')).toLowerCase();
      return needles.some(function (n) { return haystack.indexOf(n) !== -1; });
    }).slice(0, 4);
  }

  function openDrawer(matchId) {
    var m = state.matches.filter(function (x) { return String(x.id) === String(matchId); })[0];
    if (!m || !drawer) return;

    drawerBody.innerHTML =
      '<div class="match-drawer-competition">' + renderCrest(m.competition_logo, m.competition, 'match-drawer-competition-logo') +
      '<span>' + escapeHtml(m.competition) + (m.competition_country ? ' · ' + escapeHtml(m.competition_country) : '') + '</span></div>' +
      '<div class="match-drawer-teams">' +
      '<div class="match-drawer-team">' + renderCrest(m.team_a_crest, m.team_a, 'match-drawer-crest') + '<span>' + escapeHtml(m.team_a) + '</span></div>' +
      '<div class="match-drawer-center">' + statusBadge(m) + scoreOrTime(m) + '</div>' +
      '<div class="match-drawer-team">' + renderCrest(m.team_b_crest, m.team_b, 'match-drawer-crest') + '<span>' + escapeHtml(m.team_b) + '</span></div>' +
      '</div>' +
      (m.venue ? '<div class="match-drawer-meta">' + escapeHtml(m.venue) + '</div>' : '') +
      '<div class="match-drawer-section"><h3>Compositions</h3><p>Bientôt disponible.</p></div>' +
      '<div class="match-drawer-section"><h3>Événements</h3><p>Bientôt disponible.</p></div>' +
      '<div class="match-drawer-section"><h3>Statistiques</h3><p>Bientôt disponible.</p></div>' +
      '<div class="match-drawer-section"><h3>Classement</h3><p>Bientôt disponible.</p></div>' +
      '<div class="match-drawer-section match-drawer-articles"><h3>Articles Atlas Rising liés</h3><div class="match-drawer-articles-list">Chargement…</div></div>';

    drawer.hidden = false;
    requestAnimationFrame(function () { drawer.classList.add('is-open'); });
    document.body.classList.add('drawer-open');

    loadSearchIndex().then(function (index) {
      var related = relatedArticles(m, index);
      var list = drawerBody.querySelector('.match-drawer-articles-list');
      if (!list) return;
      if (!related.length) { list.innerHTML = '<p>Aucun article lié pour l\'instant.</p>'; return; }
      list.innerHTML = related.map(function (a) {
        return '<a class="match-drawer-article" href="' + root + a.url + '">' + escapeHtml(a.title) + '</a>';
      }).join('');
    });
  }

  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('is-open');
    document.body.classList.remove('drawer-open');
    setTimeout(function () { drawer.hidden = true; }, 250);
  }

  if (drawerClose) drawerClose.addEventListener('click', closeDrawer);
  if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer && !drawer.hidden) closeDrawer();
  });

  /* ---------- Auth / favoris ---------- */
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

  function refreshFavoritesUI() {
    var configured = window.AtlasAuth && window.AtlasAuth.isConfigured();
    currentUser = configured ? window.AtlasAuth.getCurrentUser() : null;
    if (currentUser && db) {
      loadFavorites(db, firestoreFns, currentUser.uid).then(function (favs) {
        state.favorites = favs;
        renderGroups();
      });
    } else {
      state.favorites = { teams: [], competitions: [] };
      renderGroups();
    }
  }

  document.addEventListener('atlas-auth-changed', function () {
    if (!db) { initFirestore().then(function (ok) { if (ok) refreshFavoritesUI(); }); }
    else { refreshFavoritesUI(); }
  });

  /* ---------- Initialisation ---------- */
  renderDateSelector();
  loadMatches();
  initFirestore();

})();
