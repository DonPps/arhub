/* Atlas Quiz — mode carrière (vanilla JS, progression en localStorage) */

(function () {

  var PROGRESS_KEY = 'atlasquiz_progress_v1';
  var QUESTION_TIME = 20; // secondes par question
  var FEEDBACK_DELAY = 1800; // ms avant la question suivante

  var page = document.getElementById('quiz-page');
  if (!page) return;

  var dataUrl = page.getAttribute('data-quiz-data');
  var questionsPromise = null;

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

  /* ---------- Progression (localStorage) ---------- */

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveProgress(progress) {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch (e) { /* stockage indisponible : progression non persistée */ }
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
    var progress = loadProgress();
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
    ranksScreen.hidden = name !== 'ranks';
    playerScreen.hidden = name !== 'player';
    resultScreen.hidden = name !== 'result';
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

    if (passed) {
      var progress = loadProgress();
      var prevBest = (progress[session.slug] && progress[session.slug].bestScore) || 0;
      progress[session.slug] = { completed: true, bestScore: Math.max(prevBest, session.correctCount) };
      saveProgress(progress);

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

  renderRanks();

})();
