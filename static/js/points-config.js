/* Atlas Rising — configuration du système Atlas Points.
 *
 * Un seul endroit pour ajuster les valeurs — IMPORTANT : POINTS_VALUES
 * doit rester synchronisé avec l'ensemble autorisé dans firestore.rules
 * (match /points/{userId}, cas "1. Gain de points") : les règles ne
 * peuvent pas lire ce fichier, donc toute valeur ajoutée/retirée ici doit
 * être répercutée manuellement là-bas.
 */

// action -> points gagnés. Chaque valeur DOIT exister dans l'ensemble
// autorisé côté règles : [2, 5, 8, 10, 15, 20, 25, 50].
export const POINTS_VALUES = {
  daily_login: 5,
  login_streak_bonus: 10,
  article_read: 5,
  match_view: 5,
  quiz_participate: 8,
  quiz_correct_answer: 2,
  podcast_listen: 8,
  content_share: 5,
  special_event: 20,
};

// Seuils de niveau (total de points cumulés nécessaire pour l'atteindre).
export const LEVELS = [
  { name: 'Rookie', threshold: 0, icon: '🌱' },
  { name: 'Supporter', threshold: 100, icon: '📣' },
  { name: 'Analyst', threshold: 300, icon: '🔍' },
  { name: 'Expert', threshold: 700, icon: '🎯' },
  { name: 'Legend', threshold: 1500, icon: '👑' },
];

export function getLevel(balance) {
  var current = LEVELS[0];
  var next = LEVELS[1] || null;
  for (var i = 0; i < LEVELS.length; i++) {
    if (balance >= LEVELS[i].threshold) {
      current = LEVELS[i];
      next = LEVELS[i + 1] || null;
    }
  }
  var progress = 1;
  if (next) {
    progress = (balance - current.threshold) / (next.threshold - current.threshold);
  }
  return {
    current: current,
    next: next,
    progress: Math.max(0, Math.min(1, progress)),
  };
}

export const RARITIES = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Limited Edition', 'Event Exclusive'];
