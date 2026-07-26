/* Atlas Quiz — mode carrière (compte requis, progression sauvegardée dans Firestore) */

import { firebaseConfigured, firebaseAppPromise } from './firebase-config.js';
import { refreshLeaderboardEntry } from './quiz-leaderboard.js';

(function () {

  var QUESTION_TIME = 20; // secondes par question
  var FEEDBACK_DELAY = 1800; // ms avant la question suivante

  var page = document.getElementById('quiz-page');
  if (!page) return;

  var dataUrl = page.getAttribute('data-quiz-data');
  var questionsPromise = null;

  var loginGateScreen = document.getElementById('quiz-login-gate');
  var ranksScreen = document.getElementById('quiz-ranks');
  var playerScreen = document.getElementById('quiz-player');
  var resultScreen = document.getElementById('quiz-result');
  var resultSuccess = document.getElementById('quiz-result-success');
  var resultFail = document.getElementById('quiz-result-fail');
  var badgesStrip = document.getElementById('quiz-badges');

  var elCounter = document.getElementById('quiz-question-counter');
  var elScore = document.getElementById('quiz-score');
  var elTimerValue = document.getElementById('quiz-timer-value');
  var elTimerBox = document.getElementById('quiz-timer');
  var elProgressFill = document.getElementById('quiz-progress-fill');
  var elCategory = document.getElementById('quiz-question-category');
  var elQuestionText = document.getElementById('quiz-question-text');
  var elAnswers = document.getElementById('quiz-answers');
  var elExplanation = document.getElementById('quiz-explanation');

  var session = null;
  var timerInterval = null;
  var db = null;
  var firestoreFns = null; // { doc, getDoc, setDoc }
  var currentProgress = {}; // cache en mémoire de la progression Firestore du user courant

  /* ---------- Firestore ---------- */

  function initFirestore() {
    if (!firebaseConfigured) return Promise.resolve(false);
    return firebaseAppPromise.then(function (app) {
      return import('https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js').then(function (mod) {
        // experimentalAutoDetectLongPolling : bascule automatiquement sur du
        // long-polling HTTP si la connexion streaming habituelle de Firestore
        // est bloquée (proxy, pare-feu, réseau restrictif) — cause confirmée
        // d'un blocage "Could not reach Cloud Firestore backend" le 26/07/2026.
        db = mod.initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
        firestoreFns = mod;
        return true;
      });
    });
  }

  function withTimeout(promise, ms, fallback) {
    return Promise.race([
      promise,
      new Promise(function (resolve) { setTimeout(function () { resolve(fallback); }, ms); }),
    ]);
  }

  function loadProgress(uid) {
    var ref = firestoreFns.doc(db, 'quizProgress', uid);
    // Filet de sécurité : si Firestore ne répond pas (réseau restrictif,
    // panne temporaire...), on ne bloque jamais l'utilisateur indéfiniment
    // sur l'écran de connexion — au pire il démarre avec une progression
    // vide plutôt qu'un écran figé.
    return withTimeout(
      firestoreFns.getDoc(ref).then(function (snap) {
        return snap.exists() ? snap.data() : {};
      }).catch(function () {
        return {};
      }),
      8000,
      {}
    );
  }

  function saveProgress(uid, progress) {
    var ref = firestoreFns.doc(db, 'quizProgress', uid);
    return firestoreFns.setDoc(ref, progress).catch(function (e) {
      console.error('Échec de la sauvegarde de la progression Atlas Quiz:', e);
    });
  }

  function getRankCards() {
    return Array.prototype.slice.call(document.querySelectorAll('.quiz-rank-card'));
  }

  function isUnlocked(order, progress, cards) {
    if (order <= 1) return true;
    var prevCard = cards.filter(function (c) { return parseInt(c.getAttribute('data-order'), 10) === order - 1; })[0];
    if (!prevCard) return true;
    var prevSlug = prevCard.getAttribute('data-rank');
    return !!(progress[prevSlug] && progress[prevSlug].completed);
  }

  /* ---------- Rendu des cartes de rang + badges ---------- */

  function renderRanks() {
    var progress = currentProgress;
    var cards = getRankCards();

    cards.forEach(function (card) {
      var slug = card.getAttribute('data-rank');
      var order = parseInt(card.getAttribute('data-order'), 10);
      var total = parseInt(card.getAttribute('data-total'), 10) || 25;
      var entry = progress[slug];
      var completed = !!(entry && entry.completed);
      var unlocked = isUnlocked(order, progress, cards);
      var best = entry ? entry.bestScore : 0;
      var pct = Math.round((best / total) * 100);

      var fill = card.querySelector('.quiz-rank-progress-fill');
      var label = card.querySelector('.quiz-rank-progress-label');
      var stateEl = card.querySelector('.quiz-rank-badge-state');
      var btn = card.querySelector('.quiz-rank-play');

      if (fill) fill.style.width = pct + '%';
      if (label) label.textContent = pct + '%';

      card.classList.toggle('is-completed', completed);
      card.classList.toggle('is-locked', !unlocked);
      card.classList.toggle('is-unlocked', unlocked);

      if (stateEl) {
        stateEl.textContent = unlocked
          ? (completed ? stateEl.getAttribute('data-unlocked-icon') : '')
          : stateEl.getAttribute('data-locked-icon');
      }

      if (btn) {
        btn.disabled = !unlocked;
        btn.textContent = unlocked ? (completed ? 'Rejouer' : 'Jouer') : 'Verrouillé';
      }
    });

    renderBadges(cards, progress);
  }

  function renderBadges(cards, progress) {
    if (!badgesStrip) return;
    badgesStrip.innerHTML = cards.map(function (card) {
      var slug = card.getAttribute('data-rank');
      var icon = card.querySelector('.quiz-rank-icon').textContent;
      var name = card.querySelector('.quiz-rank-name').textContent;
      var earned = !!(progress[slug] && progress[slug].completed);
      return '<span class="quiz-badge' + (earned ? ' is-earned' : '') + '" title="' + name + (earned ? '' : ' (non débloqué)') + '">' + icon + '</span>';
    }).join('');
  }

  /* ---------- Chargement paresseux des questions ---------- */

  function fetchQuestions() {
    if (!questionsPromise) {
      questionsPromise = fetch(dataUrl).then(function (r) { return r.json(); });
    }
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

  /* ---------- Écrans ---------- */

  function showScreen(name) {
    loginGateScreen.hidden = name !== 'login-gate';
    ranksScreen.hidden = name !== 'ranks';
    playerScreen.hidden = name !== 'player';
    resultScreen.hidden = name !== 'result';
    // Le sélecteur de duel et le classement (quiz-duel.js) ne doivent
    // s'afficher qu'aux côtés de l'écran des rangs — jamais pendant la
    // connexion, une partie solo ou son résultat.
    var duelPicker = document.getElementById('quiz-duel-picker');
    if (duelPicker) duelPicker.hidden = name !== 'ranks';
    var leaderboard = document.getElementById('quiz-leaderboard-section');
    if (leaderboard) leaderboard.hidden = name !== 'ranks';
  }

  /* ---------- Authentification : gating de la page ---------- */

  function currentUser() {
    return window.AtlasAuth ? window.AtlasAuth.getCurrentUser() : null;
  }

  function handleAuthState() {
    if (!firebaseConfigured) {
      showScreen('login-gate');
      return;
    }
    if (!window.AtlasAuth || !window.AtlasAuth.isReady()) return; // attend le premier événement

    var user = currentUser();
    if (!user) {
      session = null;
      showScreen('login-gate');
      return;
    }

    initFirestore().then(function () {
      return loadProgress(user.uid);
    }).then(function (progress) {
      currentProgress = progress;
      renderRanks();
      showScreen('ranks');
    });
  }

  document.addEventListener('atlas-auth-changed', handleAuthState);

  var gateBtn = document.getElementById('quiz-login-gate-btn');
  if (gateBtn) {
    gateBtn.addEventListener('click', function () {
      var accountToggle = document.getElementById('account-toggle');
      if (accountToggle) accountToggle.click();
    });
  }

  /* ---------- Session de quiz ---------- */

  function startQuiz(card) {
    var slug = card.getAttribute('data-rank');
    var name = card.querySelector('.quiz-rank-name').textContent;
    var icon = card.querySelector('.quiz-rank-icon').textContent;
    var total = parseInt(card.getAttribute('data-total'), 10) || 25;
    var threshold = parseInt(card.getAttribute('data-threshold'), 10) || 20;
    var btn = card.querySelector('.quiz-rank-play');
    var originalLabel = btn.textContent;
    btn.textContent = 'Chargement…';
    btn.disabled = true;

    fetchQuestions().then(function (data) {
      var pool = (data.questions || []).filter(function (q) { return q.rank === slug; });
      var picked = shuffle(pool).slice(0, total);
      session = {
        slug: slug, name: name, icon: icon, total: total, threshold: threshold,
        questions: picked, index: 0, score: 0, correctCount: 0, answered: false
      };
      btn.textContent = originalLabel;
      btn.disabled = false;
      showScreen('player');
      renderQuestion();
    }).catch(function () {
      btn.textContent = originalLabel;
      btn.disabled = false;
      alert("Impossible de charger les questions du quiz pour le moment. Réessayez dans un instant.");
    });
  }

  function renderQuestion() {
    var q = session.questions[session.index];
    session.answered = false;

    elCounter.textContent = 'Question ' + (session.index + 1) + ' / ' + session.total;
    elScore.textContent = 'Score : ' + session.score;
    elProgressFill.style.width = Math.round((session.index / session.total) * 100) + '%';
    elCategory.textContent = q.category;
    elQuestionText.textContent = q.question;
    elExplanation.hidden = true;
    elExplanation.textContent = '';

    var order = shuffle([0, 1, 2, 3]);
    elAnswers.innerHTML = '';
    order.forEach(function (origIdx) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'quiz-answer-btn';
      b.textContent = q.answers[origIdx];
      b.setAttribute('data-correct', origIdx === q.correct ? 'true' : 'false');
      b.addEventListener('click', function () { handleAnswer(b, q); });
      elAnswers.appendChild(b);
    });

    startTimer();
  }

  function startTimer() {
    clearInterval(timerInterval);
    var remaining = QUESTION_TIME;
    elTimerValue.textContent = remaining;
    elTimerBox.classList.remove('is-urgent');
    timerInterval = setInterval(function () {
      remaining--;
      elTimerValue.textContent = remaining;
      if (remaining <= 5) elTimerBox.classList.add('is-urgent');
      if (remaining <= 0) {
        clearInterval(timerInterval);
        handleAnswer(null, session.questions[session.index]);
      }
    }, 1000);
  }

  function handleAnswer(clickedBtn, q) {
    if (session.answered) return;
    session.answered = true;
    clearInterval(timerInterval);

    var buttons = Array.prototype.slice.call(elAnswers.querySelectorAll('.quiz-answer-btn'));
    var isCorrect = !!clickedBtn && clickedBtn.getAttribute('data-correct') === 'true';

    buttons.forEach(function (b) {
      b.disabled = true;
      if (b.getAttribute('data-correct') === 'true') {
        b.classList.add('is-correct');
      } else if (b === clickedBtn) {
        b.classList.add('is-wrong');
      }
    });

    if (isCorrect) { session.score++; session.correctCount++; }

    elExplanation.textContent = q.explanation;
    elExplanation.hidden = false;

    setTimeout(function () {
      session.index++;
      if (session.index >= session.total) {
        finishQuiz();
      } else {
        renderQuestion();
      }
    }, FEEDBACK_DELAY);
  }

  function finishQuiz() {
    showScreen('result');
    var passed = session.correctCount >= session.threshold;
    var user = currentUser();

    if (passed) {
      var prevBest = (currentProgress[session.slug] && currentProgress[session.slug].bestScore) || 0;
      var wasAlreadyCompleted = !!(currentProgress[session.slug] && currentProgress[session.slug].completed);
      currentProgress[session.slug] = { completed: true, bestScore: Math.max(prevBest, session.correctCount) };
      if (user) {
        saveProgress(user.uid, currentProgress);
        // Ne recalcule le classement que sur une première validation (un
        // rang déjà validé rejoué n'ajoute pas de points supplémentaires).
        if (!wasAlreadyCompleted) refreshLeaderboardEntry(db, firestoreFns, user);
      }

      resultFail.hidden = true;
      resultSuccess.hidden = false;
      document.getElementById('quiz-result-badge').innerHTML =
        '<span class="quiz-result-badge-icon">' + session.icon + '</span><span>' + session.name + ' validé</span>';
      document.getElementById('quiz-result-score-success').textContent =
        'Score final : ' + session.correctCount + ' / ' + session.total;
    } else {
      resultSuccess.hidden = true;
      resultFail.hidden = false;
      document.getElementById('quiz-result-score-fail').textContent =
        'Score final : ' + session.correctCount + ' / ' + session.total;
      document.getElementById('quiz-result-threshold').textContent =
        'Il fallait au moins ' + session.threshold + ' bonnes réponses pour valider ce rang.';
    }
  }

  /* ---------- Événements ---------- */

  document.getElementById('quiz-ranks').addEventListener('click', function (e) {
    var btn = e.target.closest('.quiz-rank-play');
    if (!btn || btn.disabled) return;
    var card = btn.closest('.quiz-rank-card');
    startQuiz(card);
  });

  document.getElementById('quiz-exit').addEventListener('click', function () {
    clearInterval(timerInterval);
    session = null;
    renderRanks();
    showScreen('ranks');
  });

  document.getElementById('quiz-continue-btn').addEventListener('click', function () {
    session = null;
    renderRanks();
    showScreen('ranks');
  });

  document.getElementById('quiz-retry-btn').addEventListener('click', function () {
    var slug = session.slug;
    var card = getRankCards().filter(function (c) { return c.getAttribute('data-rank') === slug; })[0];
    if (card) startQuiz(card);
  });

  handleAuthState();

})();
