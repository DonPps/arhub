# Atlas Rising — Notes maîtresses du projet

**Ce fichier doit être mis à jour à chaque décision ou changement important.**
Il est chargé automatiquement au début de chaque session Claude Code sur ce
projet — c'est la mémoire persistante du projet, à la différence des
conversations qui, elles, se perdent. Si tu (Claude) fais quelque chose de
notable, ajoute-le ici avant de continuer.

## Vue d'ensemble

Atlas Rising (atlasrising.net) est un média d'actualité indépendant sur le
Maroc : football, géopolitique et économie. Propriétaire : Youssef
(ochfy.youssef@gmail.com).

**Deux dépôts distincts :**
- `c:\atlas-rising-site` — le site statique (Jinja2 → HTML), hébergé sur
  **Cloudflare Pages** (PAS Netlify, malgré un `netlify.toml` résiduel dans
  le dépôt — legacy, à ignorer). Remote `origin` = GitHub `DonPps/arhub`.
  Push sur `origin` → Cloudflare rebuild automatique.
- `C:\AtlasRising` — le pipeline Python (agents de collecte/rédaction/
  publication), tourne sur un droplet DigitalOcean
  (`188.166.116.104`, `/opt/atlasrising`). Remote `server-deploy` = dépôt
  bare sur ce même droplet (`/opt/atlasrising-bare.git`).

**Aucun accès SSH direct au droplet pour Claude.** Tout déploiement pipeline
passe soit par push + auto-update (voir plus bas), soit en guidant
l'utilisateur via la console web DigitalOcean.

## Déploiement

- **Site** : entièrement automatique — push sur `origin` (GitHub) suffit,
  Cloudflare Pages rebuild et publie tout seul.
- **Pipeline** : depuis le 28/08/2026, le serveur se met à jour **tout
  seul** chaque heure (`core/health.py::check_auto_update`, `git pull
  --ff-only` sur `/opt/atlasrising`). Plus besoin de demander à
  l'utilisateur de faire `git pull` manuellement — sauf en cas d'anomalie
  signalée par le contrôleur (ex. modifications locales non commitées sur
  le serveur, voir section Pièges).

## Architecture du pipeline (C:\AtlasRising)

- `agents/foot_agent.py`, `geopolitics_agent.py`, `economie_agent.py`,
  `matches_agent.py` — cron toutes les 10-20 min, collecte RSS → Claude
  headless → publication directe (pas de validation humaine depuis le
  09/08/2026).
- `listener.py`, `agents/admin_sync_agent.py` — cron toutes les 2 min
  (réponses Telegram delete/photo, page /admin-cms).
- `agents/controller_agent.py` / `core/health.py` — cron horaire,
  auto-diagnostic + auto-réparation + auto-update du code.
- `core/publish.py` — écriture des articles + commit git, protégé par un
  verrou inter-processus (`site_repo_lock()`) pour éviter les collisions
  entre agents qui tournent en même temps.
- `core/source_image.py` — récupère la photo déjà présente sur la page
  source (og:image → twitter:image → `<img>` générique), avec filtres
  qualité : résolution min 400×250, seuil anti-flou (variance Laplacien)
  **40.0** (abaissé de 120 le 24/08/2026 — l'ancien seuil rejetait de
  vraies photos), dédoublonnage d'image sur 14 jours.
- `core/search_indexing.py` — notifie l'API d'indexation Google
  (`notify_url_updated`/`notify_url_deleted`) à chaque publication ou
  suppression.
- `core/collector.py::get_next_rss_item()` — sélection RSS par mots-clés,
  avec `avoid_keywords` (éviter un sujet sur-représenté) et
  `prefer_keywords` (booster un sous-thème rare, ex. Botola Pro).
- `publish.is_recent_duplicate_title()` — compare le titre normalisé d'un
  article fraîchement généré aux 40 derniers de la même catégorie, pour
  éviter les doublons de sujet couvert par 2 sources différentes.

**Garde-fous éditoriaux actuels (28-31/08/2026) :**
- Plafond quotidien global : 20 publications/jour, fenêtre 07h-23h heure
  marocaine (`core/daily_limit.py`).
- Géopolitique : max **2 articles Ceuta/Melilla par jour** (throttle
  quotidien, pas un blocage total) ; mots-clés élargis aux élections
  marocaines, incendies en Algérie, vie politique marocaine au sens large.
- Football : recentré sur Botola Pro, "football premium" (Liga/Premier
  League/Ligue 1-PSG), joueurs marocains suivis en priorité (Hakimi,
  Bounou, Ounahi, Bouaddi, Saibari), sélection nationale — plus de
  CAN/CAF générique, autres sélections africaines, Serie A/Bundesliga,
  gouvernance FIFA/UEFA.
- Économie (nouvelle rubrique, 31/08/2026) : croissance, investissement,
  Bourse de Casablanca, OCP, industrie automobile, tourisme, finances
  publiques — `agents/economie_agent.py`.
- Bandeau homepage "En continu" : uniquement les articles du jour même.

## Comptes et services externes

- **DigitalOcean** : droplet `188.166.116.104`, Ubuntu 24.04. Accès
  uniquement via la console web (guidée par Claude), jamais SSH direct.
- **Firebase** : projet `atlas-rising-website`. Firestore utilisé (admin
  CMS via `cms_actions`, quiz). **Storage non activé** — nécessite le
  plan payant Blaze, refusé par l'utilisateur ; upload photo via
  l'admin CMS a été retiré en conséquence (le remplacement de photo se
  fait toujours via réponse Telegram).
- **Google Cloud** : même projet `atlas-rising-website`. APIs activées :
  Indexing API, Search Console API (Google Search Console API).
  Service account `search-indexing-bot@atlas-rising-website.iam.gserviceaccount.com`,
  clé dans `C:\AtlasRising\secrets\search-indexing-service-account.json`
  (jamais commité, dans `.gitignore`), ajouté comme **Owner** sur la
  propriété Search Console (requis pour l'Indexing API et l'API Search
  Console).
- **Search Console** : propriété `sc-domain:atlasrising.net`.
- **Google Publisher Center** : publication "Atlas Rising" déjà créée
  (confirmé 31/08/2026). Depuis mars 2025, Google Actualités génère les
  pages de publication automatiquement à partir du contenu crawlé — pas
  de configuration manuelle poussée nécessaire au-delà du sitemap/schema
  déjà en place.
- **AdSense** : client `ca-pub-7966410012892502`, approuvé et actif,
  `ads.txt` généré automatiquement par `generator.py`.
- **Telegram** : bot principal (notifications de publication, réponse
  "delete" ou photo pour corriger un article) + bot social (teaser avec
  photo). Tokens dans la config du pipeline, pas dans ce dépôt.

## SEO — état des lieux (31/08/2026)

Déjà en place : sitemap, schema.org `NewsArticle` complet (headline,
image, dates, auteur, éditeur) sur `templates/article.html`, attributs
`alt` sur les images, liens internes "À lire aussi", canonical tags,
notification Indexing API à chaque publication/suppression, pas de
contenu dupliqué (détection de titre), robots.txt correct (n'autorise pas
les crawlers IA mais autorise Googlebot).

Ce qui reste comme vrais leviers : **backlinks** (aucun lien entrant
externe pour l'instant, levier n°1 pour la confiance d'un jeune domaine)
et le temps (crawl budget/autorité de domaine, rien de technique
n'accélère vraiment ça).

Indexation Google (dernier audit connu, 28/08/2026) : très peu de pages
encore indexées sur un jeune domaine (situation normale, pas un bug) ;
homepage + catégorie Football indexées et génèrent des impressions
croissantes ; le reste suit progressivement.

## Pièges connus (gotchas)

- **git auto-gc** peut bloquer un `push`/`commit` 10 à 20+ minutes sur
  cette machine Windows (dépôt site volumineux). Si CPU quasi nul sur le
  process git ET que `git log` confirme que le commit/push est déjà
  effectif, c'est sûr de tuer le process bloqué.
- **generator.py** peut se bloquer indéfiniment sur `ffmpeg` (compression
  du podcast) — fixé avec `timeout=300` le 31/08/2026
  (`_compress_audio` dans `generator.py`) ; si ça se reproduit, le
  process ffmpeg se termine tout seul après 5 min et `generator.py`
  reprend automatiquement.
- **Conflits de merge dans `dist/`** : TOUJOURS vérifier qu'aucun conflit
  n'est hors de `dist/` avant de résoudre en masse (`git diff --name-only
  --diff-filter=U | Select-String -NotMatch '^dist/'` doit être vide),
  puis `git checkout --theirs -- dist && git add dist`, reconstruire via
  `python generator.py`, puis `add -A` + `commit --no-edit`. Un
  changement dans `templates/base.html` fait conflictuer TOUS les
  fichiers `dist/article/*.html` (attendu, pas un bug).
- **PowerShell + heredocs de commit** : les guillemets/apostrophes
  cassent souvent `git commit -m @'...'@`. Préférer écrire le message
  dans un fichier scratch puis `git commit -F fichier.txt`.
- **`.git/index.lock`** : ne jamais le supprimer sans vérifier d'abord
  qu'aucun process git ne tourne (`Get-Process git`).
- **Modifications locales inattendues sur le serveur** (auto-update qui
  échoue avec "local changes would be overwritten") : vérifier le diff
  avant de trancher — si le contenu correspond à du code déjà poussé
  par Claude (juste jamais commité côté serveur), c'est sûr de faire
  `git stash` puis `git pull`.
- **Site repo (`c:\atlas-rising-site`)** : les opérations git larges
  (`git add`, `commit`, `push`, `merge`) sur ce dépôt sont **lentes**
  (plusieurs minutes, parfois 15-20+) sur cette machine — toujours les
  lancer en arrière-plan (`run_in_background: true`) et attendre plutôt
  que de supposer un blocage prématurément.

## Historique des décisions majeures (plus récent en premier)

- **31/08/2026** — Rubrique Économie créée (nouvelle catégorie + agent
  dédié) ; football recentré (Botola/ligues premium/joueurs marocains
  nommés) ; géopolitique élargie (élections, incendies Algérie) avec
  Ceuta plafonné à 2/jour (remplace un ancien ratio glissant qui avait
  fini par bloquer totalement la rubrique) ; bandeau homepage restreint
  aux news du jour ; page À propos et Mentions légales (hébergeur
  Cloudflare) réécrites ; fix du blocage `ffmpeg` dans `generator.py`.
- **~28/08/2026** — Mise à jour automatique du pipeline serveur
  (`check_auto_update`, avant ça il fallait un `git pull` manuel après
  chaque déploiement, ce qui causait des correctifs restés inactifs
  plusieurs jours) ; détection de doublons de titre après génération.
- **~24/08/2026** — Verrou inter-processus git côté pipeline
  (`site_repo_lock`, fin des erreurs `index.lock`) ; notification Google
  Indexing API à chaque publication ; seuil anti-flou des photos corrigé
  (120 → 40, rejetait de vraies photos) ; décodage des entités HTML dans
  les URL d'image (bug le360.ma).
- **~22/08/2026** — Contrôle automatique des photos manquantes après
  chaque publication (retry horaire via `core/health.py`).
- **~20/08/2026** — Plafond quotidien de publications relevé de 10 à 20,
  fenêtre étendue de 07h-20h à 07h-23h.
- **~09/08/2026** — Passage à un pipeline 100% autonome : plus de
  validation Telegram avant publication, photo prise directement sur la
  page source au lieu d'une génération Higgsfield.

## Rappels de collaboration

- L'utilisateur préfère que Claude **agisse directement** plutôt que de
  poser trop de questions — tester avant de déployer, mais ne pas
  demander confirmation pour chaque petite décision technique.
- Toujours tester en isolation (scripts scratch, mocks) avant de pousser
  un changement de logique métier (dédoublonnage, seuils, plafonds...).
- Le compte AdSense est actif — faire attention à tout ce qui pourrait
  ressembler à du contenu de masse à faible valeur ajoutée (le volume
  élevé de publications 100% automatisées est un facteur de risque
  objectif, déjà identifié).
