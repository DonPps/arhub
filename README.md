# Atlas Rising — Site (agence de presse)

Générateur de site statique, séparé du pipeline `agent.py` existant.
Objectif : site type "agence de presse" alimenté par le même contenu
que les réseaux sociaux, pensé pour l'automatisation et l'éligibilité
Google AdSense.

## Structure

```
atlas-rising-site/
├── content/
│   ├── config.json          ← catégories + pages statiques (à propos, contact, légal...)
│   ├── articles/*.json      ← un fichier JSON par article
│   └── matches.json         ← matchs du jour (équipe nationale + Botola), voir ci-dessous
├── templates/                ← templates Jinja2 (HTML)
├── static/css/style.css      ← identité visuelle (Atlas Red / Rising Green)
├── generator.py               ← génère le site dans dist/
└── dist/                      ← site final généré (à publier)
```

## Page "Matchs du jour" (content/matches.json)

Alimentée par `agents/matches_agent.py` (côté `C:\AtlasRising`, hors de ce
dépôt) : scrape le JSON structuré embarqué dans les pages kooora.com,
filtré sur l'équipe nationale et les 16 clubs du Botola Pro. Pas de
validation Telegram (donnée factuelle, pas éditoriale) — un run = scrape +
écriture + `generator.py` + commit git local.

```json
{
  "updated_at": "2026-07-22T19:47:23Z",
  "matches": [
    {
      "id": "...",
      "competition": "الدوري المغربي الممتاز",
      "team_a": "الرجاء البيضاوي",
      "team_b": "الوداد الرياضي",
      "team_a_crest": "https://...png",
      "team_b_crest": "https://...png",
      "kickoff_utc": "2026-07-22T17:00:00.000Z",
      "status": "LIVE",
      "score_a": 2,
      "score_b": 1
    }
  ]
}
```

- `status` : `LIVE`, `RESULT` ou `SCHEDULED`. `generator.py` convertit
  `kickoff_utc` en heure du Maroc (`Africa/Casablanca`) pour l'affichage.
- Pas de champ chaîne TV : ce n'est pas dans les données Kooora exploitées
  actuellement (le champ existe dans leur schéma mais reste vide sur tous
  les matchs vérifiés).
- Ne couvre que les matchs du **jour même** — pas de calendrier
  multi-semaines pour l'instant (limite de la source, voir historique de
  conversation pour le détail).

## Utilisation

```bash
pip install jinja2
python3 generator.py
```

Le site complet est généré dans `dist/`. Pour prévisualiser en local :

```bash
cd dist && python3 -m http.server 8000
```

## Format d'un article (content/articles/*.json)

```json
{
  "slug": "identifiant-url-unique",
  "title": "Titre de l'article",
  "dek": "Chapô / résumé en une phrase",
  "category": "CAN / CAF",
  "category_slug": "can-caf",
  "date": "2026-07-22",
  "read_time": 3,
  "morocco_tag": true,
  "affiliate": false,
  "image": "static/img/articles/identifiant-url-unique.jpg",
  "tags": ["CAN 2026", "Maroc"],
  "body_paragraphs": ["Paragraphe 1...", "Paragraphe 2...", "..."]
}
```

- `category_slug` doit correspondre à un slug défini dans `content/config.json` → `categories`
- `morocco_tag: true` affiche le sceau "Champions d'Afrique" sur l'article
- `affiliate: true` affiche la mention légale liens d'affiliation sous l'illustration
- `image` (optionnel) : chemin relatif à la racine du site (`static/img/articles/<slug>.jpg`)
  vers l'illustration de l'article. Si absent, un placeholder texte "Illustration" est affiché
  à la place (templates `article.html`, `index.html`, `category.html`) — un article sans image
  reste donc valide.
- Viser **300–500 mots minimum** (soit 4 à 6 paragraphes) par article — c'est la
  version longue destinée au site, distincte du post court réseaux sociaux

## Branchement avec le système d'agents (C:\AtlasRising)

Trois agents (`agents/foot_agent.py`, `agents/maroc2030_agent.py`,
`agents/geopolitics_agent.py`) envoient chacun un post brut sur Telegram.
La validation se fait en répondant (reply) avec une **photo** au message du
bot — pas de bouton. `listener.py`, relancé toutes les 1-2 min par Task
Scheduler, capte cette réponse-photo et déclenche :
1. génération de l'article long (300–500 mots, un seul appel Claude
   headless, prompt dédié par agent dans `prompts/*.md`)
2. téléchargement de la photo vers `static/img/articles/<slug>.jpg`
3. écriture de `content/articles/<slug>.json` avec ce format (champ `image` inclus)
4. exécution de `python3 generator.py`
5. `git add content/ dist/ static/ && git commit -m "Nouvel article: <titre>"`
   (commit local uniquement — pas de push automatique tant qu'un remote
   GitHub n'est pas configuré manuellement)

## Avant la demande AdSense

- [ ] Nom de domaine propre réservé et pointé vers l'hébergement
- [ ] Remplacer les `[À compléter]` dans `content/config.json` (contact, éditeur, hébergeur)
- [ ] Atteindre 20–30 articles substantiels publiés
- [ ] Activer le script AdSense dans `templates/base.html` (actuellement commenté)
- [ ] Remplacer les 3 articles d'exemple dans `content/articles/` par du vrai contenu
