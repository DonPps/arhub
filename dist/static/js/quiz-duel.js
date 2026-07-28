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
    if (!map['quiz-duel-waiting']) stopWaitingStatusRotation();
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
      return createDuel(topicMode, topicSlug, topicName, user.uid, nickname).then(function (duelId) {
        return { duelId: duelId, nickname: nickname };
      });
    }).then(function (r) {
      enterWaitingRoom(r.duelId, true, r.nickname);
    }).catch(function () {
      showScreens({ 'quiz-duel-picker': true });
      alert('Impossible de créer le duel pour le moment. Réessaie.');
    });
  }

  /* ---------- Salle d'attente (hôte) — écran de matchmaking premium :
   * la silhouette (unknown-opponent.png) ne bascule vers un vrai
   * portrait (online-opponent.png) + le vrai pseudo de l'invité que
   * lorsque Firestore signale qu'un véritable ami a rejoint (jamais de
   * délai simulé faisant croire à une recherche active). ---------- */

  var waitingStatusInterval = null;
  var WAITING_STATUS_PHRASES = ["En attente d'un adversaire", 'Ton lien est actif', "Prêt dès qu'il rejoint"];

  function stopWaitingStatusRotation() {
    if (waitingStatusInterval) { clearInterval(waitingStatusInterval); waitingStatusInterval = null; }
  }

  function startWaitingStatusRotation() {
    stopWaitingStatusRotation();
    var statusEl = document.getElementById('arena-matchmaking-status');
    if (!statusEl || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var i = 0;
    waitingStatusInterval = setInterval(function () {
      i = (i + 1) % WAITING_STATUS_PHRASES.length;
      var dots = statusEl.querySelector('.arena-dots');
      statusEl.textContent = WAITING_STATUS_PHRASES[i];
      if (dots) statusEl.appendChild(dots);
      else statusEl.innerHTML = WAITING_STATUS_PHRASES[i] + '<span class="arena-dots"><span>.</span><span>.</span><span>.</span></span>';
    }, 2400);
  }

  function enterWaitingRoom(duelId, isHost, hostNickname) {
    showScreens({ 'quiz-duel-waiting': true });
    var link = buildInviteLink(duelId);
    var linkEl = document.getElementById('quiz-duel-invite-link');
    if (linkEl) linkEl.value = link;

    var myNameEl = document.getElementById('arena-my-name');
    var oppNameEl = document.getElementById('arena-opponent-name');
    var oppAvatarEl = document.getElementById('arena-opponent-avatar');
    if (oppAvatarEl) oppAvatarEl.classList.remove('is-revealed');
    if (oppNameEl) oppNameEl.textContent = 'En attente…';
    if (myNameEl) {
      if (hostNickname) myNameEl.textContent = hostNickname;
      else { var u = currentUser(); if (u) myNickname(u).then(function (n) { myNameEl.textContent = n; }); }
    }
    startWaitingStatusRotation();

    unsubDuel = firestoreFns.onSnapshot(firestoreFns.doc(db, 'quizDuels', duelId), function (snap) {
      if (!snap.exists()) return;
      var data = snap.data();
      if (data.guestUid && data.status === 'in_progress') {
        if (unsubDuel) unsubDuel();
        stopWaitingStatusRotation();
        if (oppNameEl) oppNameEl.textContent = data.guestNickname || 'Adversaire';
        if (oppAvatarEl) oppAvatarEl.classList.add('is-revealed');
        setTimeout(function () {
          showScreens({ 'quiz-duel-loading': true });
          startDuelPlay(duelId, data, isHost);
        }, 900);
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
      renderRecentOpponents(duels, uid);
    }).catch(function () {});
  }

  /* ---------- Adversaires récents (Online Arena) — réutilise le même
   * historique déjà chargé par loadHistory (aucune requête
   * supplémentaire) : pas de liste d'amis inventée, uniquement les
   * vrais adversaires déjà affrontés. ---------- */
  function renderRecentOpponents(duels, uid) {
    var el = document.getElementById('arena-recent-opponents');
    if (!el) return;
    if (!duels.length) {
      el.innerHTML = '<p class="quizx-sidebar-empty">Aucun duel joué pour l\'instant — crée ton premier duel ci-dessus.</p>';
      return;
    }
    var seen = {};
    var opponents = [];
    duels.forEach(function (d) {
      var amHost = d.hostUid === uid;
      var oppUid = amHost ? d.guestUid : d.hostUid;
      var oppName = amHost ? d.guestNickname : d.hostNickname;
      if (!oppUid || seen[oppUid]) return;
      seen[oppUid] = true;
      opponents.push({
        name: oppName || 'Joueur', mode: d.topicMode, slug: d.topicSlug, topicName: d.topicName,
      });
    });
    if (!opponents.length) {
      el.innerHTML = '<p class="quizx-sidebar-empty">Aucun duel joué pour l\'instant — crée ton premier duel ci-dessus.</p>';
      return;
    }
    el.innerHTML = opponents.slice(0, 10).map(function (o) {
      return '<div class="arena-opponent-card">' +
        '<span class="arena-opponent-avatar">🧑</span>' +
        '<span class="arena-opponent-name">' + escapeHtml(o.name) + '</span>' +
        '<span class="arena-opponent-meta">' + escapeHtml(o.topicName || '') + '</span>' +
        '<button type="button" class="arena-opponent-rematch-btn" data-rematch-mode="' + escapeHtml(o.mode || 'rank') + '" data-rematch-slug="' + escapeHtml(o.slug || '') + '">Défier à nouveau</button>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.arena-opponent-rematch-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.getAttribute('data-rematch-mode');
        var slug = btn.getAttribute('data-rematch-slug');
        activateDuelMode(mode);
        var select = document.getElementById(mode === 'theme' ? 'quiz-duel-theme-select' : 'quiz-duel-rank-select');
        if (select && slug) select.value = slug;
        var picker = document.getElementById('quiz-duel-picker');
        if (picker) picker.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
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

  // Carte de mode "Classique" (seul mode réel pour l'instant) : amène
  // au vrai formulaire de création. Les cartes "Bientôt disponible"
  // (Classé/Blitz/Championnat) n'ont volontairement aucun listener.
  var arenaModeCard = document.querySelector('.arena-mode-card[data-scroll-target]');
  if (arenaModeCard) {
    arenaModeCard.addEventListener('click', function () {
      var target = document.getElementById(arenaModeCard.getAttribute('data-scroll-target'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

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
      var me = currentUser();
      listEl.innerHTML = rows.map(function (r, i) {
        var isMe = me && r.uid === me.uid;
        return '<div class="quiz-leaderboard-row' + (isMe ? ' is-me' : '') + '"><span class="quiz-leaderboard-rank">' + (i + 1) + '</span>' +
          '<span class="quiz-leaderboard-name">' + escapeHtml(r.nickname || 'Joueur') + '</span>' +
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

  /* ---------- Stats de l'Online Arena (onglet Défi en ligne) — toutes
   * réelles : joueurs classés + points moyens (déjà calculés par
   * loadLeaderboardStats), duels aujourd'hui (calcul client sur le
   * même lot que loadRecentAndPopular, pas de requête supplémentaire),
   * duels en direct (vrai compte des quizDuels "in_progress"). Aucun
   * indicateur de présence/temps d'attente inventé : pas d'équivalent
   * réel, donc pas affiché. ---------- */
  function isToday(timestamp) {
    if (!timestamp || !timestamp.toDate) return false;
    var d = timestamp.toDate();
    var now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }

  function loadArenaStats() {
    var rankedEl = document.getElementById('arena-stat-ranked');
    var todayEl = document.getElementById('arena-stat-today');
    var liveEl = document.getElementById('arena-stat-live');
    var avgEl = document.getElementById('arena-stat-avgpoints');
    if (!rankedEl && !todayEl && !liveEl && !avgEl) return;

    loadLeaderboardStats(db, firestoreFns).then(function (stats) {
      if (rankedEl) rankedEl.textContent = stats.count;
      if (avgEl) avgEl.textContent = stats.avgPoints;
    });

    if (todayEl) {
      var qRecent = firestoreFns.query(
        firestoreFns.collection(db, 'quizDuels'),
        firestoreFns.orderBy('createdAt', 'desc'),
        firestoreFns.limit(60)
      );
      firestoreFns.getDocs(qRecent).then(function (snap) {
        var count = 0;
        snap.forEach(function (d) { if (isToday(d.data().createdAt)) count++; });
        todayEl.textContent = count;
      }).catch(function () { todayEl.textContent = '–'; });
    }

    if (liveEl) {
      var qLive = firestoreFns.query(firestoreFns.collection(db, 'quizDuels'), firestoreFns.where('status', '==', 'in_progress'));
      firestoreFns.getDocs(qLive).then(function (snap) {
        liveEl.textContent = snap.size;
      }).catch(function () { liveEl.textContent = '–'; });
    }
  }

  /* ---------- Matchs en direct — réels : quizDuels "in_progress" sont
   * publiquement lisibles (firestore.rules), et players/{uid} lisible
   * par tout utilisateur connecté (lecture seule, jamais l'écriture).
   * Aucun spectateur interactif (pas d'écran de jeu en lecture seule
   * construit pour cette passe) : uniquement l'affichage du score qui
   * bouge en direct. ---------- */
  var liveMatchUnsubs = [];

  function clearLiveMatchListeners() {
    liveMatchUnsubs.forEach(function (fn) { fn(); });
    liveMatchUnsubs = [];
  }

  function loadLiveMatches() {
    var gridEl = document.getElementById('arena-live-matches');
    if (!gridEl) return;
    var qLive = firestoreFns.query(firestoreFns.collection(db, 'quizDuels'), firestoreFns.where('status', '==', 'in_progress'), firestoreFns.limit(30));
    firestoreFns.getDocs(qLive).then(function (snap) {
      clearLiveMatchListeners();
      var duels = [];
      snap.forEach(function (d) { duels.push({ id: d.id, data: d.data() }); });
      duels.sort(function (a, b) {
        var ta = a.data.createdAt ? a.data.createdAt.toMillis() : 0;
        var tb = b.data.createdAt ? b.data.createdAt.toMillis() : 0;
        return tb - ta;
      });
      duels = duels.slice(0, 6);

      if (!duels.length) {
        gridEl.innerHTML = '<p class="quizx-sidebar-empty">Aucun duel en direct pour l\'instant — reviens un peu plus tard.</p>';
        return;
      }

      gridEl.innerHTML = duels.map(function (d) {
        return '<div class="arena-live-card" data-duel-id="' + d.id + '">' +
          '<span class="arena-live-badge">En direct</span>' +
          '<div class="arena-live-players">' +
          '<span class="arena-live-player" id="arena-live-host-' + d.id + '">' + escapeHtml(d.data.hostNickname || '?') + ' · 0</span>' +
          '<span class="arena-live-vs">vs</span>' +
          '<span class="arena-live-player" id="arena-live-guest-' + d.id + '">' + escapeHtml(d.data.guestNickname || '?') + ' · 0</span>' +
          '</div>' +
          '<p class="arena-live-topic">' + escapeHtml(d.data.topicName || '') + '</p>' +
          '</div>';
      }).join('');

      duels.forEach(function (d) {
        if (d.data.hostUid) {
          liveMatchUnsubs.push(firestoreFns.onSnapshot(firestoreFns.doc(db, 'quizDuels', d.id, 'players', d.data.hostUid), function (snap) {
            var el = document.getElementById('arena-live-host-' + d.id);
            if (el && snap.exists()) el.textContent = (d.data.hostNickname || '?') + ' · ' + (snap.data().score || 0);
          }));
        }
        if (d.data.guestUid) {
          liveMatchUnsubs.push(firestoreFns.onSnapshot(firestoreFns.doc(db, 'quizDuels', d.id, 'players', d.data.guestUid), function (snap) {
            var el = document.getElementById('arena-live-guest-' + d.id);
            if (el && snap.exists()) el.textContent = (d.data.guestNickname || '?') + ' · ' + (snap.data().score || 0);
          }));
        }
      });
    }).catch(function () {
      gridEl.innerHTML = '<p class="quizx-sidebar-empty">Indisponible pour l\'instant.</p>';
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
      loadArenaStats();
      loadRecentAndPopular();
      loadLiveMatches();
      setInterval(function () { loadArenaStats(); loadLiveMatches(); }, 20000);
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
