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

(function () {

  var DUEL_QUESTION_COUNT = 10;

  var page = document.getElementById('quiz-page');
  if (!page) return;
  var dataUrl = page.getAttribute('data-quiz-data');

  var pickerScreen = document.getElementById('quiz-duel-picker');
  var joinScreen = document.getElementById('quiz-duel-join');
  var waitingScreen = document.getElementById('quiz-duel-waiting');
  var playerScreen = document.getElementById('quiz-duel-player');
  var resultScreen = document.getElementById('quiz-duel-result');
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
    // Coordination avec quiz.js : ces écrans de duel remplacent
    // temporairement la vue "rangs" (et donc le sélecteur de duel
    // lui-même) tant qu'un duel est en cours — le retour se fait par
    // navigation complète (lien "Retour à Atlas Quiz"), pas par un état
    // à restaurer ici.
    [pickerScreen, joinScreen, waitingScreen, playerScreen, resultScreen, document.getElementById('quiz-ranks')].forEach(function (el) {
      if (el) el.hidden = true;
    });
    Object.keys(map).forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.hidden = !map[id];
    });
  }

  /* ---------- Création d'un duel ---------- */

  function createDuel(rankSlug, rankName, total, hostUid, hostNickname) {
    return fetchQuestions().then(function (data) {
      var pool = (data.questions || []).filter(function (q) { return q.rank === rankSlug; });
      var count = Math.min(DUEL_QUESTION_COUNT, pool.length);
      var indices = shuffle(pool.map(function (_, i) { return i; })).slice(0, count);

      var duelRef = firestoreFns.doc(firestoreFns.collection(db, 'quizDuels'));
      var duelDoc = {
        hostUid: hostUid,
        hostNickname: hostNickname,
        guestUid: null,
        guestNickname: null,
        rankSlug: rankSlug,
        rankName: rankName,
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
    url.search = '?duel=' + duelId;
    return url.toString();
  }

  function startHostFlow(rankSlug, rankName, total) {
    var user = currentUser();
    if (!user) return;
    myNickname(user).then(function (nickname) {
      return createDuel(rankSlug, rankName, total, user.uid, nickname);
    }).then(function (duelId) {
      enterWaitingRoom(duelId, true);
    }).catch(function () {
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
    if (!user) return; // la porte de connexion générale du quiz gère déjà ce cas

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
      setJoinMessage(
        (data.hostNickname || 'Un joueur') + ' te défie sur le rang "' + data.rankName + '" !',
        true
      );
      var btn = document.getElementById('quiz-duel-join-btn');
      if (btn) {
        btn.onclick = function () {
          btn.disabled = true;
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
            btn.disabled = false;
            setJoinMessage('Impossible de rejoindre ce duel — réessaie.', false);
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
    showScreens({ 'quiz-duel-player': true });
    var opponentUid = isHost ? duelData.guestUid : duelData.hostUid;
    var myUid = currentUser().uid;

    fetchQuestions().then(function (data) {
      var pool = (data.questions || []).filter(function (q) { return q.rank === duelData.rankSlug; });
      var questions = duelData.questionIndices.map(function (i) { return pool[i]; });

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
    }, 1800);
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
        '<span>' + (d.rankName || '') + ' vs ' + (oppName || '?') + '</span>' +
        '<span>' + myScore + '–' + oppScore + '</span></div>';
    }).join('');
  }

  /* ---------- Sélecteur de rang (créer un duel) ---------- */

  function renderPicker() {
    if (!pickerScreen) return;
    var cards = Array.prototype.slice.call(document.querySelectorAll('.quiz-rank-card'));
    var select = document.getElementById('quiz-duel-rank-select');
    if (!select) return;
    select.innerHTML = cards.map(function (c) {
      return '<option value="' + c.getAttribute('data-rank') + '">' + c.querySelector('.quiz-rank-name').textContent + '</option>';
    }).join('');
  }

  var createBtn = document.getElementById('quiz-duel-create-btn');
  if (createBtn) {
    createBtn.addEventListener('click', function () {
      var select = document.getElementById('quiz-duel-rank-select');
      var slug = select.value;
      var card = document.querySelector('.quiz-rank-card[data-rank="' + slug + '"]');
      if (!card) return;
      var name = card.querySelector('.quiz-rank-name').textContent;
      var total = Math.min(DUEL_QUESTION_COUNT, parseInt(card.getAttribute('data-total'), 10) || 10);
      createBtn.disabled = true;
      startHostFlow(slug, name, total);
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
    var user = currentUser();
    if (!user) return;
    initFirestore().then(function () {
      renderPicker();
      loadHistory(user.uid);
      checkJoinFromUrl();
    });
  }

  document.addEventListener('atlas-auth-changed', init);
  init();

})();
