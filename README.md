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
│   └── articles/*.json      ← un fichier JSON par article
├── templates/                ← templates Jinja2 (HTML)
├── static/css/style.css      ← identité visuelle (Atlas Red / Rising Green)
├── generator.py               ← génère le site dans dist/
└── dist/                      ← site final généré (à publier)
```

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
  "tags": ["CAN 2026", "Maroc"],
  "body_paragraphs": ["Paragraphe 1...", "Paragraphe 2...", "..."]
}
```

- `category_slug` doit correspondre à un slug défini dans `content/config.json` → `categories`
- `morocco_tag: true` affiche le sceau "Champions d'Afrique" sur l'article
- Viser **300–500 mots minimum** (soit 4 à 6 paragraphes) par article — c'est la
  version longue destinée au site, distincte du post court réseaux sociaux

## Branchement avec l'agent existant (prochaine étape)

Après validation Telegram (👍) dans `agent.py` :
1. générer un texte long (300–500 mots) à partir du même sujet que le post social
2. écrire un fichier `content/articles/<slug>.json` avec ce format
3. exécuter `python3 generator.py`
4. `git add dist/ content/ && git commit -m "Nouvel article: <titre>" && git push`
   → déploiement automatique si `dist/` est publié via GitHub Pages / Cloudflare Pages

## Avant la demande AdSense

- [ ] Nom de domaine propre réservé et pointé vers l'hébergement
- [ ] Remplacer les `[À compléter]` dans `content/config.json` (contact, éditeur, hébergeur)
- [ ] Atteindre 20–30 articles substantiels publiés
- [ ] Activer le script AdSense dans `templates/base.html` (actuellement commenté)
- [ ] Remplacer les 3 articles d'exemple dans `content/articles/` par du vrai contenu
