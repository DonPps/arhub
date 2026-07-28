/* Atlas Quiz — mode Duel (1v1 temps réel via Firestore, lien d'invitation).
 *
 * Indépendant du mode carrière (quiz.js) : coexiste sur la même page sans
 * toucher à sa logique. Un duel = un document Firestore quizDuels/{id}
 * (métadonnées : rang, questions, hôte, invité) + une sous-collection
 * players/{uid} (un document par joueur : score et progression, chacun
 * n'écrivant jamais que le sien — voir firestore.rules). Les deux clients
 * s'écoutent en temps réel via onSnapshot pour afficher le score de
 * l'adversaire en direct.
 */

import { firebaseConfigured, firebaseAppPromise } from './firebase-config.js';
import { refreshLeaderboardEntry, loadTopPlayers, loadLeaderboardStats } from './quiz-leaderboard.js';

(function () {

  var DUEL_QUESTION_COUNT = 10;
  var DUEL_FEEDBACK_DELAY = 1100; // plus court que le mode carrière (1800ms) — un duel doit rester rythmé

  var page = document.getElementById('quiz-page');
  if (!page) return;
  var dataUrl = page.getAttribute('data-quiz-data');

  var pickerScreen = document.getElementById('quiz-duel-picker');
  var joinScreen = document.getElementById('quiz-duel-join');
  var waitingScreen = document.getElementById('quiz-duel-waiting');
  var playerScreen = document.getElementById('quiz-duel-player');
  var resultScreen = document.getElementById('quiz-duel-result');
  var loadingScreen = document.getElementById('quiz-duel-loading');
  var leaderboardSection = document.getElementById('quiz-leaderboard-section');
  var duelLoginGate = document.getElementById('quiz-duel-login-gate');
  var historyList = document.getElementById('quiz-duel-history-list');

  var db = null;
  var firestoreFns = null;
  var questionsPromise = null;
  var unsubDuel = null;
  var unsubOpponent = null;
  var duelState = null; // { duelId, isHost, rankSlug, questions: [...], me: {score,index,finished}, opponent: {...} }

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

  function fetchQuestions() {
    if (!questionsPromise) questionsPromise = fetch(dataUrl).then(function (r) { return r.json(); });
    return questionsPromise;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function withTimeout(promise, ms, fallback) {
    return Promise.race([promise, new Promise(function (resolve) { setTimeout(function () { resolve(fallback); }, ms); })]);
  }

  function currentUser() {
    return window.AtlasAuth ? window.AtlasAuth.getCurrentUser() : null;
  }

  function myNickname(user) {
    var ref = firestoreFns.doc(db, 'users', user.uid);
    return withTimeout(
      firestoreFns.getDoc(ref).then(function (snap) { return snap.exists() ? snap.data().nickname : null; }).catch(function () { return null; }),
      5000, null
    ).then(function (nickname) {
      return nickname || user.displayName || (user.email || 'Joueur').split('@')[0];
    });
  }

  function showScreens(map) {
    // Onglet Défi en ligne, indépendant de l'onglet Quiz Solo (quiz.js) :
    // ces écrans de duel se remplacent entre eux au sein du même onglet
    // — le retour au picker se fait par navigation complète (lien
    // "Retour aux duels"), pas par un état à restaurer ici.
    [pickerScreen, joinScreen, waitingScreen, playerScreen, resultScreen, loadingScreen, leaderboardSection, duelLoginGate].forEach(function (el) {
      if (el) el.hidden = true;
    });
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = !map[id];
    });
  }

  /* ---------- Sélection des questions (rang OU thème) ---------- */

  function poolFor(questions, topicMode, topicSlug) {
    return questions.filter(function (q) {
      return topicMode === 'theme' ? q.category === topicSlug : q.rank === topicSlug;
    });
  }

  /* ---------- Création d'un duel ---------- */

  function createDuel(topicMode, topicSlug, topicName, hostUid, hostNickname) {
    return fetchQuestions().then(function (data) {
      var pool = poolFor(data.questions || [], topicMode, topicSlug);
      var count = Math.min(DUEL_QUESTION_COUNT, pool.length);
      var indices = shuffle(pool.map(function (_, i) { return i; })).slice(0, count);

      var duelRef = firestoreFns.doc(firestoreFns.collection(db, 'quizDuels'));
      var duelDoc = {
        hostUid: hostUid,
        hostNickname: hostNickname,
        guestUid: null,
        guestNickname: null,
        topicMode: topicMode,
        topicSlug: topicSlug,
        topicName: topicName,
        total: count,
        questionIndices: indices,
        status: 'waiting',
        createdAt: firestoreFns.serverTimestamp(),
      };
      return firestoreFns.setDoc(duelRef, duelDoc).then(function () {
        return firestoreFns.setDoc(firestoreFns.doc(db, 'quizDuels', duelRef.id, 'players', hostUid), {
          nickname: hostNickname, score: 0, index: 0, finished: false,
        });
      }).then(function () { return duelRef.id; });
    });
  }

  function buildInviteLink(duelId) {
    var url = new URL(window.location.href);
    url.search = '?tab=quiz-duel&duel=' + duelId;
    return url.toString();
  }

  function startHostFlow(topicMode, topicSlug, topicName) {
    var user = currentUser();
    if (!user) return;
    showScreens({ 'quiz-duel-loading': true });
    myNickname(user).then(function (nickname) {
      return createDuel(topicMode, topicSlug, topicName, user.uid, nickname);
    }).then(function (duelId) {
      enterWaitingRoom(duelId, true);
    }).catch(function () {
      showScreens({ 'quiz-duel-picker': true });
      alert('Impossible de créer le duel pour le moment. Réessaie.');
    });
  }

  /* ---------- Salle d'attente (hôte) ---------- */

  function enterWaitingRoom(duelId, isHost) {
    showScreens({ 'quiz-duel-waiting': true });
    var link = buildInviteLink(duelId);
    var linkEl = document.getElementById('quiz-duel-invite-link');
    if (linkEl) linkEl.value = link;

    unsubDuel = firestoreFns.onSnapshot(firestoreFns.doc(db, 'quizDuels', duelId), function (snap) {
      if (!snap.exists()) return;
      var data = snap.data();
      if (data.guestUid && data.status === 'in_progress') {
        if (unsubDuel) unsubDuel();
        showScreens({ 'quiz-duel-loading': true });
        startDuelPlay(duelId, data, isHost);
      }
    });
  }

  /* ---------- Rejoindre un duel via lien ---------- */

  function checkJoinFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var duelId = params.get('duel');
    if (!duelId) return;

    var user = currentUser();
    if (!user) return; // init() a déjà affiché la porte de connexion du duel dans ce cas

    firestoreFns.getDoc(firestoreFns.doc(db, 'quizDuels', duelId)).then(function (snap) {
      if (!snap.exists()) {
        showScreens({ 'quiz-duel-join': true });
        setJoinMessage("Ce lien de duel n'existe plus.");
        return;
      }
      var data = snap.data();

      if (data.hostUid === user.uid || data.guestUid === user.uid) {
        // Déjà participant (hôte qui rouvre son lien, ou invité déjà entré)
        if (data.status === 'in_progress' || data.guestUid) {
          showScreens({ 'quiz-duel-loading': true });
          startDuelPlay(duelId, data, data.hostUid === user.uid);
        } else {
          enterWaitingRoom(duelId, true);
        }
        return;
      }

      if (data.guestUid) {
        showScreens({ 'quiz-duel-join': true });
        setJoinMessage('Ce duel est déjà complet.');
        return;
      }

      showScreens({ 'quiz-duel-join': true });
      var topicLabel = data.topicMode === 'theme' ? 'le thème' : 'le rang';
      setJoinMessage(
        (data.hostNickname || 'Un joueur') + ' te défie sur ' + topicLabel + ' "' + data.topicName + '" !',
        true
      );
      var btn = document.getElementById('quiz-duel-join-btn');
      if (btn) {
        btn.onclick = function () {
          btn.disabled = true;
          showScreens({ 'quiz-duel-loading': true });
          myNickname(user).then(function (nickname) {
            return firestoreFns.updateDoc(firestoreFns.doc(db, 'quizDuels', duelId), {
              guestUid: user.uid, guestNickname: nickname, status: 'in_progress',
            }).then(function () {
              return firestoreFns.setDoc(firestoreFns.doc(db, 'quizDuels', duelId, 'players', user.uid), {
                nickname: nickname, score: 0, index: 0, finished: false,
              });
            }).then(function () {
              data.guestUid = user.uid;
              data.guestNickname = nickname;
              startDuelPlay(duelId, data, false);
            });
          }).catch(function () {
            showScreens({ 'quiz-duel-join': true });
            btn.disabled = false;
            setJoinMessage('Impossible de rejoindre ce duel — réessaie.', true);
          });
        };
      }
    });
  }

  function setJoinMessage(text, showBtn) {
    var msgEl = document.getElementById('quiz-duel-join-message');
    var btn = document.getElementById('quiz-duel-join-btn');
    if (msgEl) msgEl.textContent = text;
    if (btn) btn.hidden = !showBtn;
  }

  /* ---------- Partie synchronisée ---------- */

  function startDuelPlay(duelId, duelData, isHost) {
    var opponentUid = isHost ? duelData.guestUid : duelData.hostUid;
    var myUid = currentUser().uid;

    fetchQuestions().then(function (data) {
      var pool = poolFor(data.questions || [], duelData.topicMode, duelData.topicSlug);
      var questions = duelData.questionIndices.map(function (i) { return pool[i]; });
      showScreens({ 'quiz-duel-player': true });

      duelState = {
        duelId: duelId, isHost: isHost, myUid: myUid, opponentUid: opponentUid,
        questions: questions, total: questions.length,
        me: { score: 0, index: 0, finished: false },
        opponent: { score: 0, index: 0, finished: false },
      };

      document.getElementById('quiz-duel-opponent-name').textContent = isHost ? duelData.guestNickname : duelData.hostNickname;

      unsubOpponent = firestoreFns.onSnapshot(firestoreFns.doc(db, 'quizDuels', duelId, 'players', opponentUid), function (snap) {
        if (!snap.exists()) return;
        duelState.opponent = snap.data();
        renderOpponentStatus();
        checkDuelComplete();
      });

      renderDuelQuestion();
    });
  }

  function renderOpponentStatus() {
    var el = document.getElementById('quiz-duel-opponent-score');
    if (!el || !duelState) return;
    el.textContent = duelState.opponent.finished
      ? 'Terminé — ' + duelState.opponent.score + '/' + duelState.total
      : (duelState.opponent.index || 0) + '/' + duelState.total + ' en cours';
  }

  function renderDuelQuestion() {
    var q = duelState.questions[duelState.me.index];
    document.getElementById('quiz-duel-counter').textContent = 'Question ' + (duelState.me.index + 1) + ' / ' + duelState.total;
    document.getElementById('quiz-duel-my-score').textContent = 'Toi : ' + duelState.me.score;
    document.getElementById('quiz-duel-category').textContent = q.category;
    document.getElementById('quiz-duel-question-text').textContent = q.question;
    renderOpponentStatus();

    var explanation = document.getElementById('quiz-duel-explanation');
    explanation.hidden = true;
    explanation.textContent = '';

    var answersEl = document.getElementById('quiz-duel-answers');
    answersEl.innerHTML = '';
    var order = shuffle([0, 1, 2, 3]);
    order.forEach(function (origIdx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'quiz-answer-btn';
      b.textContent = q.answers[origIdx];
      b.setAttribute('data-correct', origIdx === q.correct ? 'true' : 'false');
      b.addEventListener('click', function () { handleDuelAnswer(b, q); });
      answersEl.appendChild(b);
    });
  }

  function handleDuelAnswer(clickedBtn, q) {
    if (duelState.answered) return;
    duelState.answered = true;
    var isCorrect = clickedBtn.getAttribute('data-correct') === 'true';

    Array.prototype.slice.call(document.getElementById('quiz-duel-answers').querySelectorAll('.quiz-answer-btn')).forEach(function (b) {
      b.disabled = true;
      if (b.getAttribute('data-correct') === 'true') b.classList.add('is-correct');
      else if (b === clickedBtn) b.classList.add('is-wrong');
    });

    if (isCorrect) duelState.me.score++;
    var explanation = document.getElementById('quiz-duel-explanation');
    explanation.textContent = q.explanation;
    explanation.hidden = false;

    setTimeout(function () {
      duelState.me.index++;
      duelState.answered = false;
      var myRef = firestoreFns.doc(db, 'quizDuels', duelState.duelId, 'players', duelState.myUid);
      if (duelState.me.index >= duelState.total) {
        duelState.me.finished = true;
        firestoreFns.updateDoc(myRef, { score: duelState.me.score, index: duelState.me.index, finished: true });
        showDuelWaitingForOpponent();
        checkDuelComplete();
      } else {
        firestoreFns.updateDoc(myRef, { score: duelState.me.score, index: duelState.me.index });
        renderDuelQuestion();
      }
    }, DUEL_FEEDBACK_DELAY);
  }

  function showDuelWaitingForOpponent() {
    if (duelState.opponent.finished) return; // déjà fini, checkDuelComplete gèrera l'affichage du résultat
    document.getElementById('quiz-duel-counter').textContent = 'Terminé — en attente de l\'adversaire…';
    document.getElementById('quiz-duel-answers').innerHTML = '';
    document.getElementById('quiz-duel-question-text').textContent = 'Tu as fini ! Score : ' + duelState.me.score + '/' + duelState.total;
  }

  function checkDuelComplete() {
    if (!duelState || !duelState.me.finished || !duelState.opponent.finished) return;
    if (unsubOpponent) { unsubOpponent(); unsubOpponent = null; }

    var myScore = duelState.me.score;
    var oppScore = duelState.opponent.score;
    var winnerUid = myScore === oppScore ? null : (myScore > oppScore ? duelState.myUid : duelState.opponentUid);

    var duelRef = firestoreFns.doc(db, 'quizDuels', duelState.duelId);
    var finalData = duelState.isHost
      ? { status: 'finished', finalHostScore: myScore, finalGuestScore: oppScore, winnerUid: winnerUid }
      : { status: 'finished', finalHostScore: oppScore, finalGuestScore: myScore, winnerUid: winnerUid };
    firestoreFns.updateDoc(duelRef, finalData).catch(function () {}); // déjà clôturé par l'autre client : pas grave
    var me = currentUser();
    if (me) refreshLeaderboardEntry(db, firestoreFns, me).then(function () { loadLeaderboard(); });

    showScreens({ 'quiz-duel-result': true });
    var titleEl = document.getElementById('quiz-duel-result-title');
    var scoreEl = document.getElementById('quiz-duel-result-score');
    if (winnerUid === null) titleEl.textContent = 'Égalité !';
    else if (winnerUid === duelState.myUid) titleEl.textContent = 'Tu as gagné ! 🎉';
    else titleEl.textContent = 'Défaite';
    scoreEl.textContent = 'Toi : ' + myScore + '/' + duelState.total + ' — Adversaire : ' + oppScore + '/' + duelState.total;
  }

  /* ---------- Historique ---------- */

  function loadHistory(uid) {
    if (!historyList) return;
    var qHost = firestoreFns.query(firestoreFns.collection(db, 'quizDuels'), firestoreFns.where('hostUid', '==', uid), firestoreFns.where('status', '==', 'finished'));
    var qGuest = firestoreFns.query(firestoreFns.collection(db, 'quizDuels'), firestoreFns.where('guestUid', '==', uid), firestoreFns.where('status', '==', 'finished'));

    Promise.all([firestoreFns.getDocs(qHost), firestoreFns.getDocs(qGuest)]).then(function (snaps) {
      var duels = [];
      snaps.forEach(function (snap) { snap.forEach(function (d) { duels.push(d.data()); }); });
      duels.sort(function (a, b) {
        var ta = a.createdAt ? a.createdAt.toMillis() : 0;
        var tb = b.createdAt ? b.createdAt.toMillis() : 0;
        return tb - ta;
      });
      renderHistory(duels.slice(0, 10), uid);
    }).catch(function () {});
  }

  function renderHistory(duels, uid) {
    if (!duels.length) {
      historyList.innerHTML = '<p class="quiz-duel-history-empty">Aucun duel joué pour l\'instant.</p>';
      return;
    }
    historyList.innerHTML = duels.map(function (d) {
      var amHost = d.hostUid === uid;
      var myScore = amHost ? d.finalHostScore : d.finalGuestScore;
      var oppScore = amHost ? d.finalGuestScore : d.finalHostScore;
      var oppName = amHost ? d.guestNickname : d.hostNickname;
      var outcome = myScore === oppScore ? 'Égalité' : (myScore > oppScore ? 'Victoire' : 'Défaite');
      return '<div class="quiz-duel-history-row"><span class="quiz-duel-history-outcome quiz-duel-history-' + outcome.toLowerCase() + '">' + outcome + '</span>' +
        '<span>' + (d.topicName || '') + ' vs ' + (oppName || '?') + '</span>' +
        '<span>' + myScore + '–' + oppScore + '</span></div>';
    }).join('');
  }

  /* ---------- Sélecteur rang / thème (créer un duel) ---------- */

  var activeDuelMode = 'rank';

  function renderPicker() {
    if (!pickerScreen) return;
    var cards = Array.prototype.slice.call(document.querySelectorAll('.quiz-rank-card'));
    var rankSelect = document.getElementById('quiz-duel-rank-select');
    if (rankSelect) {
      rankSelect.innerHTML = cards.map(function (c) {
        return '<option value="' + c.getAttribute('data-rank') + '">' + c.querySelector('.quiz-rank-name').textContent + '</option>';
      }).join('');
    }

    var themeSelect = document.getElementById('quiz-duel-theme-select');
    if (themeSelect) {
      fetchQuestions().then(function (data) {
        var themes = [];
        (data.questions || []).forEach(function (q) {
          if (q.category && themes.indexOf(q.category) === -1) themes.push(q.category);
        });
        themes.sort();
        themeSelect.innerHTML = themes.map(function (t) {
          return '<option value="' + t + '">' + t + '</option>';
        }).join('');
      });
    }
  }

  function activateDuelMode(mode) {
    activeDuelMode = mode;
    Array.prototype.slice.call(document.querySelectorAll('.quiz-duel-mode-tab')).forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-mode') === mode);
    });
    document.getElementById('quiz-duel-rank-select').hidden = mode !== 'rank';
    document.getElementById('quiz-duel-theme-select').hidden = mode !== 'theme';
  }

  Array.prototype.slice.call(document.querySelectorAll('.quiz-duel-mode-tab')).forEach(function (tab) {
    tab.addEventListener('click', function () { activateDuelMode(tab.getAttribute('data-mode')); });
  });

  // Cartes catégories (thèmes) : préselectionne le thème du duel et amène
  // l'utilisateur directement sur le formulaire de création.
  Array.prototype.slice.call(document.querySelectorAll('.quizx-category-card')).forEach(function (card) {
    card.addEventListener('click', function () {
      var theme = card.getAttribute('data-theme');
      var picker = document.getElementById('quiz-duel-picker');
      if (!picker || picker.hidden) return; // pas connecté : rien à sélectionner
      activateDuelMode('theme');
      var themeSelect = document.getElementById('quiz-duel-theme-select');
      if (themeSelect) themeSelect.value = theme;
      picker.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  var createBtn = document.getElementById('quiz-duel-create-btn');
  if (createBtn) {
    createBtn.addEventListener('click', function () {
      if (activeDuelMode === 'theme') {
        var themeSelect = document.getElementById('quiz-duel-theme-select');
        var theme = themeSelect.value;
        if (!theme) return;
        startHostFlow('theme', theme, theme);
      } else {
        var rankSelect = document.getElementById('quiz-duel-rank-select');
        var slug = rankSelect.value;
        var card = document.querySelector('.quiz-rank-card[data-rank="' + slug + '"]');
        if (!card) return;
        var name = card.querySelector('.quiz-rank-name').textContent;
        startHostFlow('rank', slug, name);
      }
    });
  }

  /* ---------- Classement ---------- */

  function loadLeaderboard() {
    var listEl = document.getElementById('quiz-leaderboard-list');
    if (!listEl) return;
    loadTopPlayers(db, firestoreFns, 20).then(function (rows) {
      if (!rows.length) {
        listEl.innerHTML = '<p class="quiz-duel-history-empty">Le classement se remplira au fil des premières parties.</p>';
        return;
      }
      rows.sort(function (a, b) { return (b.points || 0) - (a.points || 0); });
      listEl.innerHTML = rows.map(function (r, i) {
        return '<div class="quiz-leaderboard-row"><span class="quiz-leaderboard-rank">' + (i + 1) + '</span>' +
          '<span class="quiz-leaderboard-name">' + (r.nickname || 'Joueur') + '</span>' +
          '<span class="quiz-leaderboard-points">' + (r.points || 0) + ' pts</span></div>';
      }).join('');
    });
  }

  function loadRecentAndPopular() {
    var recentEl = document.getElementById('quizx-recent-duels');
    var popularEl = document.getElementById('quizx-popular-themes');
    if (!recentEl && !popularEl) return;

    // Un seul tri par date (index automatique, pas de composite requis) —
    // le filtre "finished" se fait côté client sur le lot récupéré.
    var q = firestoreFns.query(
      firestoreFns.collection(db, 'quizDuels'),
      firestoreFns.orderBy('createdAt', 'desc'),
      firestoreFns.limit(60)
    );
    firestoreFns.getDocs(q).then(function (snap) {
      var finished = [];
      snap.forEach(function (d) { var data = d.data(); if (data.status === 'finished') finished.push(data); });

      if (recentEl) {
        var recent = finished.slice(0, 6);
        recentEl.innerHTML = recent.length ? recent.map(function (d) {
          var outcome = d.winnerUid === null ? 'Égalité' : (d.finalHostScore === d.finalGuestScore ? 'Égalité' : 'Terminé');
          return '<div class="quizx-recent-row">' +
            '<span class="quizx-recent-players">' + escapeHtml(d.hostNickname || '?') + ' <span class="quizx-recent-vs">vs</span> ' + escapeHtml(d.guestNickname || '?') + '</span>' +
            '<span class="quizx-recent-topic">' + escapeHtml(d.topicName || '') + '</span>' +
            '<span class="quizx-recent-score">' + d.finalHostScore + '–' + d.finalGuestScore + '</span>' +
          '</div>';
        }).join('') : '<p class="quizx-sidebar-empty">Aucun duel joué pour l\'instant.</p>';
      }

      if (popularEl) {
        var counts = {};
        finished.forEach(function (d) {
          if (!d.topicName) return;
          counts[d.topicName] = (counts[d.topicName] || 0) + 1;
        });
        var popular = Object.keys(counts).map(function (name) { return { name: name, count: counts[name] }; })
          .sort(function (a, b) { return b.count - a.count; }).slice(0, 6);
        popularEl.innerHTML = popular.length ? popular.map(function (p) {
          return '<div class="quizx-recent-row"><span class="quizx-recent-topic">' + escapeHtml(p.name) + '</span>' +
            '<span class="quizx-recent-score">' + p.count + ' duel' + (p.count > 1 ? 's' : '') + '</span></div>';
        }).join('') : '<p class="quizx-sidebar-empty">Pas encore assez de duels pour un classement.</p>';
      }
    }).catch(function () {
      if (recentEl) recentEl.innerHTML = '<p class="quizx-sidebar-empty">Indisponible pour l\'instant.</p>';
      if (popularEl) popularEl.innerHTML = '<p class="quizx-sidebar-empty">Indisponible pour l\'instant.</p>';
    });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function loadHeroStats() {
    var playersEl = document.getElementById('quizx-stat-players');
    var avgEl = document.getElementById('quizx-stat-avgpoints');
    if (!playersEl && !avgEl) return;
    loadLeaderboardStats(db, firestoreFns).then(function (stats) {
      if (playersEl) playersEl.textContent = stats.count;
      if (avgEl) avgEl.textContent = stats.avgPoints;
    });
  }

  var copyBtn = document.getElementById('quiz-duel-copy-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', function () {
      var input = document.getElementById('quiz-duel-invite-link');
      input.select();
      navigator.clipboard && navigator.clipboard.writeText(input.value);
      copyBtn.textContent = 'Copié !';
      setTimeout(function () { copyBtn.textContent = 'Copier le lien'; }, 2000);
    });
  }

  /* ---------- Démarrage ---------- */

  function init() {
    // Les statistiques de la section Hero (joueurs classés, points moyens)
    // sont publiques (lecture ouverte sur "leaderboard") et doivent
    // s'afficher meme pour un visiteur non connecte, contrairement au
    // reste de cette page (rangs/duel/classement detaille), verrouille
    // par la porte de connexion generale du quiz (voir quiz.js).
    initFirestore().then(function () {
      loadHeroStats();
      loadRecentAndPopular();
    });

    var user = currentUser();
    if (!user) {
      showScreens({ 'quiz-duel-login-gate': true });
      return;
    }
    showScreens({ 'quiz-duel-picker': true });
    initFirestore().then(function () {
      renderPicker();
      loadHistory(user.uid);
      loadLeaderboard();
      checkJoinFromUrl();
    });
  }

  var duelGateBtn = document.getElementById('quiz-duel-login-gate-btn');
  if (duelGateBtn) {
    duelGateBtn.addEventListener('click', function () {
      var toggle = document.getElementById('account-toggle');
      if (toggle) toggle.click();
    });
  }

  document.addEventListener('atlas-auth-changed', init);
  init();

})();
