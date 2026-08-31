#!/usr/bin/env python3
"""
Générateur de site statique Atlas Rising.

Usage :
    python3 generator.py

Lit les articles depuis content/articles/*.json et la config depuis
content/config.json, génère le site complet dans dist/.

Ce script est conçu pour être appelé automatiquement par l'agent
(agent.py) après validation Telegram d'un nouvel article : il suffit
d'écrire un nouveau fichier JSON dans content/articles/ puis de
relancer ce script.
"""

import hashlib
import json
import shutil
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from jinja2 import Environment, FileSystemLoader, select_autoescape

MOROCCO_TZ = ZoneInfo("Africa/Casablanca")

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).parent
CONTENT_DIR = ROOT / "content"
ARTICLES_DIR = CONTENT_DIR / "articles"
TEMPLATES_DIR = ROOT / "templates"
STATIC_DIR = ROOT / "static"
DIST_DIR = ROOT / "dist"
PODCAST_DIR = ROOT / "Podcast"
BACKGROUND_DIR = ROOT / "Background"

TRENDING_COUNT = 5   # nombre d'articles affichés dans le bloc "Tendances"
RELATED_COUNT = 5    # nombre d'articles affichés dans "À lire aussi" (max demandé : 5)

# Mots-clés utilisés pour repérer, parmi les articles déjà catégorisés
# football, ceux qui concernent spécifiquement le Maroc — il n'existe pas
# de catégorie dédiée pour ce thème (juste des tags libres par article),
# donc filtrage best-effort par mot-clé plutôt qu'un nouveau champ de
# données.
MAROC_KEYWORDS = ["maroc", "frmf", "lions de l'atlas", "lionnes de l'atlas"]


def _matches_keywords(article, keywords):
    haystack = " ".join([article.get("title", "")] + article.get("tags", [])).lower()
    return any(kw in haystack for kw in keywords)

PODCAST_AUDIO_EXTS = {".mp3", ".m4a", ".wav", ".ogg"}
PODCAST_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
BACKGROUND_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
BACKGROUND_DEST = "static/img/sahara-bg.jpg"  # nom fixe attendu par style.css


PODCAST_MAX_BYTES = 20 * 1024 * 1024  # marge sous la limite Cloudflare Pages (25 Mio/fichier)
PODCAST_COMPRESS_BITRATE = "96k"       # mono, largement suffisant pour de la voix

# Assets globaux chargés par base.html sur toutes les pages — leur hash
# combiné sert de cache-buster (?v=...). Sans ça, un navigateur ou le
# cache CDN peut continuer à servir l'ancien style.css/JS après un
# déploiement, ce qui donne l'impression qu'un changement n'est pas
# passé alors qu'il est bien en ligne (cause confirmée le 27/07/2026).
GLOBAL_ASSET_FILES = [
    "css/style.css",
    "js/main.js",
    "js/floating-widgets.js",
    "js/auth.js",
    "js/ads/ad-manager.js",
    "js/hero-slider.js",
    "js/reveal.js",
]


def _asset_version() -> str:
    h = hashlib.md5()
    for rel_path in GLOBAL_ASSET_FILES:
        path = STATIC_DIR / rel_path
        if path.exists():
            h.update(path.read_bytes())
    return h.hexdigest()[:10]


def _compress_audio(source: Path, dest: Path) -> None:
    """Réencode un fichier audio trop volumineux en AAC mono 96 kbps (voix
    uniquement, donc perte de qualité imperceptible) — utilisé quand la
    source dépasse PODCAST_MAX_BYTES. Toujours produit un .m4a en sortie,
    quel que soit le format d'origine, pour éviter d'avoir à gérer un
    encodeur différent par extension.

    timeout=300 : retour utilisateur du 31/08/2026 — un run de
    generator.py est resté bloqué indéfiniment sur un process ffmpeg
    suspendu (jamais de sortie, jamais d'erreur), sans timeout pour
    l'interrompre. Tous les autres subprocess.run() de ce dépôt ont déjà
    un timeout ; celui-ci était le seul oublié."""
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run(
        [ffmpeg, "-y", "-i", str(source), "-ac", "1", "-b:a", PODCAST_COMPRESS_BITRATE,
         "-movflags", "+faststart", str(dest)],
        capture_output=True, check=True, timeout=300,
    )


def _compress_cover_image(source: Path, dest: Path, max_width: int = 900) -> None:
    """Redimensionne (largeur max) et réencode en JPEG qualité 86 — les
    pochettes déposées telles quelles (export ChatGPT) pèsent souvent
    plusieurs Mo, hors de proportion pour une image de carte."""
    from PIL import Image
    with Image.open(source) as img:
        img = img.convert("RGB")
        if img.width > max_width:
            new_height = int(img.height * max_width / img.width)
            img = img.resize((max_width, new_height), Image.LANCZOS)
        img.save(dest, "JPEG", quality=86)


def load_podcast():
    """Détecte le premier fichier audio (+ éventuelle couverture) déposé
    dans Podcast/, et les copie vers dist/static/podcast/ sous un nom
    prévisible (episode.<ext>, cover.<ext>). Le nom d'origine peut contenir
    espaces/virgules/accents (ex. export ChatGPT) — on ne veut pas de ça
    dans une URL publique, donc on renomme plutôt que d'espérer que
    l'encodage survive intact à travers Jinja/git/Netlify.

    Si le fichier dépasse PODCAST_MAX_BYTES (cause réelle d'un échec de
    déploiement Cloudflare Pages le 26/07/2026 — limite de 25 Mio/fichier),
    il est automatiquement recompressé en AAC mono 96 kbps plutôt que copié
    tel quel.

    Retourne None si aucun fichier audio n'est présent — le spot podcast
    reste alors simplement masqué sur la page d'accueil."""
    if not PODCAST_DIR.exists():
        return None
    files = sorted(p for p in PODCAST_DIR.iterdir() if p.is_file())
    audio = next((p for p in files if p.suffix.lower() in PODCAST_AUDIO_EXTS), None)
    if not audio:
        return None
    cover = next((p for p in files if p.suffix.lower() in PODCAST_IMAGE_EXTS), None)

    dest_dir = DIST_DIR / "static" / "podcast"
    dest_dir.mkdir(parents=True, exist_ok=True)

    if audio.stat().st_size > PODCAST_MAX_BYTES:
        audio_url = "static/podcast/episode.m4a"
        try:
            _compress_audio(audio, dest_dir / "episode.m4a")
        except Exception as e:
            print(f"⚠️  Compression audio échouée ({e}) — copie du fichier original tel quel.")
            audio_url = f"static/podcast/episode{audio.suffix.lower()}"
            shutil.copy2(audio, dest_dir / f"episode{audio.suffix.lower()}")
    else:
        audio_url = f"static/podcast/episode{audio.suffix.lower()}"
        shutil.copy2(audio, dest_dir / f"episode{audio.suffix.lower()}")

    cover_url = None
    if cover:
        try:
            _compress_cover_image(cover, dest_dir / "cover.jpg")
            cover_url = "static/podcast/cover.jpg"
        except Exception as e:
            print(f"⚠️  Compression pochette podcast échouée ({e}) — copie du fichier original tel quel.")
            shutil.copy2(cover, dest_dir / f"cover{cover.suffix.lower()}")
            cover_url = f"static/podcast/cover{cover.suffix.lower()}"

    return {
        "audio_url": audio_url,
        "cover_url": cover_url,
    }


def load_background():
    """Si une image est déposée dans Background/, elle remplace le fond du
    site (Sahara en filigrane, cf. body{background-image} dans style.css)
    — même traitement CSS (cover, centré bas, fixe, voile crème) quel que
    soit le fichier fourni. style.css référence un nom de fichier fixe
    (sahara-bg.jpg), donc on convertit systématiquement en JPEG plutôt que
    de garder l'extension d'origine (contrairement au podcast, où le nom
    est injecté dynamiquement dans le HTML).

    N'écrit rien si Background/ est vide : le fond par défaut déjà présent
    dans static/img/ (copié par le shutil.copytree juste avant) reste tel
    quel."""
    if not BACKGROUND_DIR.exists():
        return
    files = sorted(
        p for p in BACKGROUND_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in BACKGROUND_IMAGE_EXTS
    )
    if not files:
        return

    source = files[0]
    dest = DIST_DIR / BACKGROUND_DEST
    dest.parent.mkdir(parents=True, exist_ok=True)

    if source.suffix.lower() in (".jpg", ".jpeg"):
        shutil.copy2(source, dest)
    else:
        from PIL import Image
        img = Image.open(source).convert("RGB")
        img.save(dest, "JPEG", quality=88, optimize=True)


def load_config():
    with open(CONTENT_DIR / "config.json", encoding="utf-8") as f:
        return json.load(f)


def load_quiz_ranks():
    path = STATIC_DIR / "data" / "quiz-questions.json"
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return sorted(data.get("ranks", []), key=lambda r: r["order"])


def load_quiz_question_count():
    path = STATIC_DIR / "data" / "quiz-questions.json"
    if not path.exists():
        return 0
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return len(data.get("questions", []))


QUIZ_THEME_ICONS = {
    "Maroc": "🇲🇦", "Histoire": "📜", "Joueurs": "⭐", "Records": "🏆",
    "Football Africain": "🌍", "Coupe du Monde": "🌐", "Clubs": "🛡️",
    "CAF": "🏅", "Entraîneurs": "📋", "FIFA": "⚽", "Arbitrage": "🟨",
    "Statistiques": "📊", "Tactique": "♟️", "Ligue des Champions": "👑",
}


def load_quiz_themes():
    path = STATIC_DIR / "data" / "quiz-questions.json"
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    names = sorted({q["category"] for q in data.get("questions", []) if q.get("category")})
    return [{"name": n, "icon": QUIZ_THEME_ICONS.get(n, "🔖")} for n in names]


MATCHES_DIR = CONTENT_DIR / "matches"


def load_matches_index():
    """Dates réellement archivées (voir agents/matches_agent.py côté
    pipeline) — sert au sélecteur de date pour savoir ce qui est
    consultable sans avoir à deviner la fenêtre de fetch."""
    path = MATCHES_DIR / "index.json"
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return sorted(data.get("available_dates", []))


def load_matches_for_date(date_str):
    path = MATCHES_DIR / f"{date_str}.json"
    if not path.exists():
        return None, []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)

    matches = data.get("matches", [])
    for m in matches:
        m["kickoff_local"] = ""
        if m.get("kickoff_utc"):
            try:
                dt_utc = datetime.strptime(m["kickoff_utc"], "%Y-%m-%dT%H:%M:%S.%fZ")
                dt_local = dt_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(MOROCCO_TZ)
                m["kickoff_local"] = dt_local.strftime("%Hh%M")
            except ValueError:
                pass

    updated_at = data.get("updated_at")
    updated_at_local = None
    if updated_at:
        try:
            dt_utc = datetime.strptime(updated_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=ZoneInfo("UTC"))
            updated_at_local = dt_utc.astimezone(MOROCCO_TZ).strftime("%d/%m/%Y à %Hh%M")
        except ValueError:
            pass

    return updated_at_local, matches


def group_matches_by_competition(matches):
    """Regroupe une liste de matchs (déjà triée par coup d'envoi) par
    compétition, dans l'ordre d'apparition — pas de tri alphabétique
    supplémentaire, pour garder les compétitions avec le match le plus
    proche en premier."""
    groups = {}
    order = []
    for m in matches:
        key = m["competition"]
        if key not in groups:
            groups[key] = {
                "name": key,
                "logo": m.get("competition_logo"),
                "country": m.get("competition_country"),
                "matches": [],
            }
            order.append(key)
        groups[key]["matches"].append(m)
    return [groups[k] for k in order]


def build_teams_and_competitions_index():
    """Liste agrégée de toutes les équipes/compétitions vues dans
    l'archive des matchs (nom + logo réel) — permet de mettre en favori
    une équipe même les jours où elle ne joue pas. Construite uniquement
    à partir de ce qui a déjà été récupéré (aucun appel API
    supplémentaire) : ne couvre donc que ce qui est passé par la fenêtre
    suivie jusqu'ici, pas "toutes les équipes du monde"."""
    teams = {}
    competitions = {}
    if MATCHES_DIR.exists():
        for f in MATCHES_DIR.glob("*.json"):
            if f.stem == "index":
                continue
            with open(f, encoding="utf-8") as fh:
                data = json.load(fh)
            for m in data.get("matches", []):
                for name, crest in ((m.get("team_a"), m.get("team_a_crest")), (m.get("team_b"), m.get("team_b_crest"))):
                    if name and name not in teams:
                        teams[name] = {"name": name, "crest": crest, "competition": m.get("competition")}
                comp_name = m.get("competition")
                if comp_name and comp_name not in competitions:
                    competitions[comp_name] = {
                        "name": comp_name,
                        "logo": m.get("competition_logo"),
                        "country": m.get("competition_country"),
                    }
    return (
        sorted(teams.values(), key=lambda t: t["name"]),
        sorted(competitions.values(), key=lambda c: c["name"]),
    )


CARDS_DIR = CONTENT_DIR / "cards"
PACKS_DIR = CONTENT_DIR / "packs"

# Terrain Dream Team — une seule formation (4-3-3) pour cette première
# passe ; les 11 postes sont fixes côté template, static/js/dream-team.js
# associe chaque slot à la/les position(s) de carte compatibles.
DREAMTEAM_SLOTS = [
    {"id": "GK", "label": "Gardien"},
    {"id": "LB", "label": "Arrière gauche"},
    {"id": "CB1", "label": "Défenseur central"},
    {"id": "CB2", "label": "Défenseur central"},
    {"id": "RB", "label": "Arrière droit"},
    {"id": "CM1", "label": "Milieu"},
    {"id": "CM2", "label": "Milieu"},
    {"id": "CM3", "label": "Milieu"},
    {"id": "LW", "label": "Ailier gauche"},
    {"id": "ST", "label": "Attaquant"},
    {"id": "RW", "label": "Ailier droit"},
]

# Roster d'entraîneurs Dream Team — contenu original propre à l'univers
# Atlas Rising (même logique que le catalogue de cartes joueurs : pas une
# donnée réelle détournée). "formation" et "bonus" sont des attributs
# d'affichage uniquement — aucun impact sur la formation réelle (toujours
# 4-3-3, unique) ni sur le calcul de chimie, tous deux inchangés.
COACHES = [
    {"slug": "hakim-belmadi", "name": "Hakim Belmadi", "flag": "🇲🇦", "formation": "4-3-3", "rarity": "epic", "bonus": "Vision Tactique"},
    {"slug": "marc-aubry", "name": "Marc Aubry", "flag": "🇫🇷", "formation": "4-4-2", "rarity": "rare", "bonus": "Boost Défense"},
    {"slug": "samuel-okoye", "name": "Samuel Okoye", "flag": "🇳🇬", "formation": "4-3-3", "rarity": "common", "bonus": "Focus Jeunes"},
    {"slug": "elena-vidal", "name": "Elena Vidal", "flag": "🇪🇸", "formation": "4-1-4-1", "rarity": "rare", "bonus": "Expérience Compétition"},
    {"slug": "joao-medeiros", "name": "João Medeiros", "flag": "🇧🇷", "formation": "3-5-2", "rarity": "mythic", "bonus": "+2 Chemistry"},
    {"slug": "kenji-watanabe", "name": "Kenji Watanabe", "flag": "🇯🇵", "formation": "4-2-3-1", "rarity": "legendary", "bonus": "Boost Attaque"},
]


def build_cards_catalog():
    """Catalogue des cartes Atlas Points — jamais générées, déposées par
    l'équipe (voir plan de refonte Matchs/section 22). Un dossier par
    collection (content/cards/<collection-slug>/<card-slug>.json), image
    attendue en static/img/cards/<collection-slug>/<card-slug>.jpg sauf
    si un champ "image" explicite est fourni. Retourne une liste vide
    tant qu'aucun fichier n'a été déposé — jamais de carte inventée."""
    cards = []
    if not CARDS_DIR.exists():
        return cards
    for collection_dir in sorted(p for p in CARDS_DIR.iterdir() if p.is_dir()):
        for card_file in sorted(collection_dir.glob("*.json")):
            with open(card_file, encoding="utf-8") as f:
                card = json.load(f)
            card.setdefault("slug", card_file.stem)
            card.setdefault("collection", collection_dir.name)
            card.setdefault("image", f"static/img/cards/{collection_dir.name}/{card_file.stem}.jpg")
            cards.append(card)
    return cards


def build_packs_catalog():
    """Définitions de packs (content/packs/<pack-slug>.json) — prix/
    rareté/pool de cartes, source de vérité aussi lue par firestore.rules
    via get() au moment de l'achat/ouverture. Vide tant qu'aucun pack
    n'est défini."""
    packs = []
    if not PACKS_DIR.exists():
        return packs
    for pack_file in sorted(PACKS_DIR.glob("*.json")):
        with open(pack_file, encoding="utf-8") as f:
            pack = json.load(f)
        pack.setdefault("slug", pack_file.stem)
        pack.setdefault("image", f"static/img/packs/{pack_file.stem}.jpg")
        packs.append(pack)
    return packs


def _image_aspect_ratio(image_rel_path):
    """Ratio CSS ("w/h") calculé depuis les dimensions réelles du fichier.

    Le cadre .hero-media épouse ainsi toujours l'image telle qu'elle est
    (au lieu d'un 16:9 fixe) — évite qu'une illustration au ratio
    différent (ex. générée hors du pipeline standard) soit rognée ou
    affichée avec des bandes vides. Retombe sur 16/9 si le fichier est
    introuvable ou illisible.
    """
    try:
        from PIL import Image
        with Image.open(ROOT / image_rel_path) as img:
            w, h = img.size
        return f"{w}/{h}"
    except Exception:
        return "16/9"


def load_articles():
    articles = []
    for path in sorted(ARTICLES_DIR.glob("*.json")):
        with open(path, encoding="utf-8") as f:
            articles.append(json.load(f))
    # tri du plus récent au plus ancien
    articles.sort(key=lambda a: a["date"], reverse=True)
    for a in articles:
        if a.get("image"):
            a["image_ratio"] = _image_aspect_ratio(a["image"])
    return articles


def build():
    config = load_config()
    articles = load_articles()

    if DIST_DIR.exists():
        shutil.rmtree(DIST_DIR)
    DIST_DIR.mkdir(parents=True)

    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES_DIR)),
        autoescape=select_autoescape(["html"]),
    )
    env.filters["tojson"] = lambda v: json.dumps(v, ensure_ascii=False)

    common = {
        "site_url": config["site_url"],
        "categories": config["categories"],
        "categories_by_slug": {c["slug"]: c for c in config["categories"]},
        "today": date.today().strftime("%d/%m/%Y"),
        "year": date.today().year,
        # Retour utilisateur du 28/08/2026 : le bandeau "En continu" doit
        # impérativement n'afficher QUE les news du jour, jamais des
        # articles plus anciens même récents — se vide simplement (bandeau
        # masqué, voir {% if ticker %} dans base.html) tant qu'aucun
        # article n'a encore été publié aujourd'hui.
        "ticker": [a for a in articles if a.get("date") == date.today().isoformat()][:10],
        # Widgets flottants (base.html, présents sur toutes les pages) :
        # podcast pour la mini-pop-up lecteur, quiz pour le lien direct.
        "podcast": load_podcast(),
        "asset_version": _asset_version(),
    }

    # ---------- Page d'accueil ----------
    # Chaque section a sa propre liste (pas de grande liste générique) —
    # voir MAROC_KEYWORDS pour le filtrage par mot-clé (pas de catégorie
    # dédiée). Chevauchement volontaire entre sections assumé (stock
    # d'articles encore limité) : voir le plan de refonte homepage pour
    # le détail de ce choix.
    trending = articles[:TRENDING_COUNT]

    football_all = [a for a in articles if a["category_slug"] == "football"]
    football_maroc_all = [a for a in football_all if _matches_keywords(a, MAROC_KEYWORDS)]
    maroc_articles = football_maroc_all[:4]
    football_articles = football_all[:6]

    geomaroc_all = [a for a in articles if a["category_slug"] == "geomaroc"]
    geomaroc_articles = geomaroc_all[:4]
    mercato_articles = [a for a in articles if a["category_slug"] == "transferts"][:4]

    # À la une : recentrée sur le Maroc uniquement (retour utilisateur du
    # 10/08/2026 — "les plus viraux" ; pas de mesure d'audience réelle sur
    # ce site, donc proxy pragmatique = géopolitique + foot marocain,
    # jamais le foot mondial générique, trié par actualité la plus
    # récente). Complété par le reste si le pool Maroc est trop petit,
    # pour ne jamais afficher moins de 5 slides.
    #
    # Épinglage manuel (retour utilisateur du 21/08/2026, page /admin-cms) :
    # un article avec "pinned": true passe TOUJOURS avant la sélection
    # automatique ci-dessus, dans l'ordre de date le plus récent — c'est le
    # seul cas où l'algorithme keyword+date n'a pas le dernier mot.
    pinned_articles = sorted(
        [a for a in articles if a.get("pinned")], key=lambda a: a["date"], reverse=True
    )
    hero_pool = sorted(geomaroc_all + football_maroc_all, key=lambda a: a["date"], reverse=True)
    hero_slides = pinned_articles[:5]
    if len(hero_slides) < 5:
        seen_slugs = {a["slug"] for a in hero_slides}
        filler = [a for a in hero_pool if a["slug"] not in seen_slugs][: 5 - len(hero_slides)]
        hero_slides = hero_slides + filler
    if len(hero_slides) < 5:
        seen_slugs = {a["slug"] for a in hero_slides}
        filler = [a for a in articles if a["slug"] not in seen_slugs][: 5 - len(hero_slides)]
        hero_slides = hero_slides + filler

    tpl = env.get_template("index.html")
    html = tpl.render(
        **common,
        root="",
        canonical_path="/",
        active_nav="home",
        hero_slides=hero_slides,
        trending=trending,
        geomaroc_articles=geomaroc_articles,
        mercato_articles=mercato_articles,
        football_articles=football_articles,
        maroc_articles=maroc_articles,
    )
    (DIST_DIR / "index.html").write_text(html, encoding="utf-8")

    # ---------- Blog (posts rédigés manuellement par le propriétaire,
    # tagués [BLOG] via Telegram — voir agents/blog_agent.py côté pipeline.
    # Ne contient PAS les news du pipeline automatique (football /
    # transferts) : celles-ci restent uniquement sur
    # l'accueil, leur page catégorie, et les pages articles individuelles.
    blog_posts = [a for a in articles if a.get("category_slug") == "blog"]
    tpl = env.get_template("blog.html")
    html = tpl.render(
        **common,
        root="",
        canonical_path="/blog.html",
        active_nav="blog",
        articles=blog_posts,
        trending=trending,
    )
    (DIST_DIR / "blog.html").write_text(html, encoding="utf-8")

    # ---------- Pages articles ----------
    article_dir = DIST_DIR / "article"
    article_dir.mkdir(parents=True, exist_ok=True)
    tpl = env.get_template("article.html")

    for i, art in enumerate(articles):
        related = [a for a in articles if a["slug"] != art["slug"]][:RELATED_COUNT]
        html = tpl.render(
            **common,
            root="../",
            canonical_path=f"/article/{art['slug']}.html",
            active_nav=art.get("category_slug", ""),
            article=art,
            related=related,
        )
        (article_dir / f"{art['slug']}.html").write_text(html, encoding="utf-8")

    # ---------- Pages catégories ----------
    cat_dir = DIST_DIR / "categorie"
    cat_dir.mkdir(parents=True, exist_ok=True)
    tpl = env.get_template("category.html")

    for cat in config["categories"]:
        cat_articles = [a for a in articles if a.get("category_slug") == cat["slug"]]
        html = tpl.render(
            **common,
            root="../",
            canonical_path=f"/categorie/{cat['slug']}.html",
            active_nav=cat["slug"],
            category=cat,
            articles=cat_articles,
        )
        (cat_dir / f"{cat['slug']}.html").write_text(html, encoding="utf-8")

    # ---------- Pages statiques (à propos, contact, légal...) ----------
    tpl = env.get_template("static_page.html")
    for page in config["static_pages"]:
        html = tpl.render(
            **common,
            root="",
            canonical_path=f"/{page['slug']}.html",
            active_nav="",
            page=page,
        )
        (DIST_DIR / f"{page['slug']}.html").write_text(html, encoding="utf-8")

    # ---------- Page Matchs ----------
    matches_dates = load_matches_index()
    today_str = datetime.now(MOROCCO_TZ).strftime("%Y-%m-%d")
    matches_updated_at, today_matches = load_matches_for_date(today_str)
    matches_groups = group_matches_by_competition(today_matches)

    # Copie l'archive brute (un JSON par date) pour la navigation de date
    # côté client (static/js/matches.js) — c'est notre propre fichier déjà
    # généré, aucun coût API supplémentaire à la consulter.
    if MATCHES_DIR.exists():
        matches_dist_dir = DIST_DIR / "static" / "data" / "matches"
        matches_dist_dir.mkdir(parents=True, exist_ok=True)
        for f in MATCHES_DIR.glob("*.json"):
            shutil.copy2(f, matches_dist_dir / f.name)

    # Index équipes/compétitions déjà rencontrées dans l'archive — sert à
    # pouvoir suivre une équipe en favori même les jours où elle ne joue
    # pas (voir profil.html). Régénéré à chaque build, coût zéro (aucun
    # appel API, juste relire ce qu'on a déjà).
    teams_index, competitions_index = build_teams_and_competitions_index()
    data_dir = DIST_DIR / "static" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "teams.json").write_text(json.dumps(teams_index, ensure_ascii=False), encoding="utf-8")
    (data_dir / "competitions.json").write_text(json.dumps(competitions_index, ensure_ascii=False), encoding="utf-8")

    tpl = env.get_template("matches.html")
    html = tpl.render(
        **common,
        root="",
        canonical_path="/matchs.html",
        active_nav="matchs",
        matches_groups=matches_groups,
        matches_updated_at=matches_updated_at,
        matches_dates=matches_dates,
        today_str=today_str,
    )
    (DIST_DIR / "matchs.html").write_text(html, encoding="utf-8")

    # ---------- Atlas Points : catalogue cartes/packs (affichage) ----------
    # Source de vérité pour le PRIX/POOL au moment d'un achat reste
    # toujours Firestore (packs/{slug}, voir firestore.rules) — ces
    # fichiers ne servent qu'à afficher rapidement la boutique/collection
    # sans dépendre d'une lecture Firestore pour la simple LISTE. Rappel :
    # tout pack ajouté ici doit aussi être recopié dans Firestore
    # (collection `packs`) pour être achetable — même principe que
    # firestore.rules, jamais déployé automatiquement.
    cards_catalog = build_cards_catalog()
    packs_catalog = build_packs_catalog()
    (data_dir / "cards.json").write_text(json.dumps(cards_catalog, ensure_ascii=False), encoding="utf-8")
    (data_dir / "packs.json").write_text(json.dumps(packs_catalog, ensure_ascii=False), encoding="utf-8")

    # ---------- Page Play (Atlas Quiz + Boutique + Collection + Dream Team) ----------
    # Fusionnées en une seule page à onglets (décision utilisateur) — les
    # 4 anciennes URLs restent servies mais redirigent désormais vers le
    # bon onglet de play.html (voir plus bas), pour ne pas casser les
    # liens déjà partagés (notamment dream-team.html?u=<uid>).
    quiz_ranks = load_quiz_ranks()
    quiz_question_count = load_quiz_question_count()
    quiz_themes = load_quiz_themes()
    tpl = env.get_template("play.html")
    html = tpl.render(
        **common,
        root="",
        canonical_path="/play.html",
        active_nav="play",
        quiz_ranks=quiz_ranks,
        quiz_question_count=quiz_question_count,
        quiz_themes=quiz_themes,
        dreamteam_slots=DREAMTEAM_SLOTS,
        dreamteam_coaches=COACHES,
    )
    (DIST_DIR / "play.html").write_text(html, encoding="utf-8")

    # ---------- Redirections des anciennes URLs vers le bon onglet ----------
    redirect_tpl = env.get_template("redirect.html")
    for old_page, target_tab in (
        ("quiz", "quiz"),
        ("boutique", "boutique"),
        ("collection", "collection"),
        ("dream-team", "dreamteam"),
    ):
        html = redirect_tpl.render(root="", target_tab=target_tab)
        (DIST_DIR / f"{old_page}.html").write_text(html, encoding="utf-8")

    # ---------- Page Profil ----------
    tpl = env.get_template("profil.html")
    html = tpl.render(
        **common,
        root="",
        canonical_path="/profil.html",
        active_nav="profil",
        quiz_ranks=quiz_ranks,
    )
    (DIST_DIR / "profil.html").write_text(html, encoding="utf-8")

    # ---------- Page admin (emplacements publicitaires) ----------
    # Pas de lien dans la nav, pas dans le sitemap (noindex dans le
    # template) — outil interne, protege par firestore.rules (email du
    # proprietaire) et par un verrou cote client dans admin-ads.js.
    tpl = env.get_template("admin-ads.html")
    html = tpl.render(
        **common,
        root="",
        canonical_path="/admin-ads.html",
        active_nav="",
    )
    (DIST_DIR / "admin-ads.html").write_text(html, encoding="utf-8")

    # ---------- Page admin (gestion des articles) ----------
    # Même principe que admin-ads.html : pas de lien nav, noindex, protégé
    # par firestore.rules (email du propriétaire) + verrou client
    # admin-cms.js.
    tpl = env.get_template("admin-cms.html")
    html = tpl.render(
        **common,
        root="",
        canonical_path="/admin-cms.html",
        active_nav="",
    )
    (DIST_DIR / "admin-cms.html").write_text(html, encoding="utf-8")

    # ---------- Fichiers statiques (css, images) ----------
    shutil.copytree(STATIC_DIR, DIST_DIR / "static", dirs_exist_ok=True)
    load_background()

    # ---------- Index de recherche (JS côté client) ----------
    search_index = [
        {
            "title": a["title"],
            "dek": a["dek"],
            "category": a["category"],
            "url": f"article/{a['slug']}.html",
            "tags": a.get("tags", []),
        }
        for a in articles
    ]
    (DIST_DIR / "static" / "search-index.json").write_text(
        json.dumps(search_index, ensure_ascii=False), encoding="utf-8"
    )

    # ---------- Index articles pour la page admin (/admin-cms) ----------
    # Les articles ne vivent pas dans Firestore (juste des fichiers JSON
    # dans content/articles/) — cet index, régénéré à chaque build comme
    # search-index.json, donne à admin-cms.js de quoi lister/rechercher les
    # articles sans dupliquer leur contenu dans Firestore. Toujours à jour
    # au prochain build (~20/jour via le pipeline), jamais plus périmé que
    # ça — acceptable pour un outil d'admin.
    admin_index = [
        {
            "slug": a["slug"],
            "title": a["title"],
            "category": a["category"],
            "category_slug": a["category_slug"],
            "date": a["date"],
            "image": a.get("image"),
            "pinned": bool(a.get("pinned")),
        }
        for a in articles
    ]
    (DIST_DIR / "static" / "admin-articles-index.json").write_text(
        json.dumps(admin_index, ensure_ascii=False), encoding="utf-8"
    )

    # Contenu complet de chaque article, copié tel quel (même principe que
    # dist/static/data/matches/) — permet à admin-cms.js de charger un
    # article en entier (dek, tags, paragraphes) au clic sur "Modifier",
    # sans alourdir admin-articles-index.json qui reste un simple index.
    admin_articles_dir = DIST_DIR / "static" / "data" / "articles"
    admin_articles_dir.mkdir(parents=True, exist_ok=True)
    for path in ARTICLES_DIR.glob("*.json"):
        shutil.copy2(path, admin_articles_dir / path.name)

    # ---------- sitemap.xml ----------
    today_iso = date.today().isoformat()
    url_entries = [("/", today_iso), ("/blog.html", today_iso)]
    url_entries += [(f"/article/{a['slug']}.html", a["date"]) for a in articles]
    url_entries += [(f"/categorie/{c['slug']}.html", today_iso) for c in config["categories"]]
    url_entries += [(f"/{p['slug']}.html", today_iso) for p in config["static_pages"]]
    url_entries += [("/matchs.html", today_iso)]
    url_entries += [("/play.html", today_iso)]
    url_entries += [("/profil.html", today_iso)]
    sitemap_entries = "\n".join(
        f"  <url><loc>{config['site_url']}{u}</loc><lastmod>{lm}</lastmod></url>"
        for u, lm in url_entries
    )
    sitemap = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        f"{sitemap_entries}\n"
        "</urlset>\n"
    )
    (DIST_DIR / "sitemap.xml").write_text(sitemap, encoding="utf-8")

    # ---------- robots.txt ----------
    robots = f"User-agent: *\nAllow: /\nSitemap: {config['site_url']}/sitemap.xml\n"
    (DIST_DIR / "robots.txt").write_text(robots, encoding="utf-8")

    # ---------- ads.txt (obligatoire pour qu'AdSense diffuse des pubs) ----------
    ads_txt = "google.com, pub-7966410012892502, DIRECT, f08c47fec0942fa0\n"
    (DIST_DIR / "ads.txt").write_text(ads_txt, encoding="utf-8")

    # ---------- PWA : manifest.json + service-worker.js ----------
    manifest = {
        "name": "Atlas Rising",
        "short_name": "Atlas Rising",
        "description": "Atlas Rising — l'actualité du football marocain et africain, sans détour.",
        "start_url": "/",
        "scope": "/",
        "display": "standalone",
        "background_color": "#0E0C0A",
        "theme_color": "#0E0C0A",
        "lang": "fr",
        "icons": [
            {"src": "/static/img/pwa/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/pwa/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/static/img/pwa/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }
    (DIST_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    sw_tpl = env.get_template("service-worker.js")
    (DIST_DIR / "service-worker.js").write_text(
        sw_tpl.render(asset_version=common["asset_version"]), encoding="utf-8"
    )

    print(f"✅ Site généré dans {DIST_DIR} — {len(articles)} article(s).")


if __name__ == "__main__":
    build()
