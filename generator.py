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
# can-caf, ceux qui concernent spécifiquement le Maroc — il n'existe pas
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
    encodeur différent par extension."""
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    subprocess.run(
        [ffmpeg, "-y", "-i", str(source), "-ac", "1", "-b:a", PODCAST_COMPRESS_BITRATE,
         "-movflags", "+faststart", str(dest)],
        capture_output=True, check=True,
    )


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

    if cover:
        shutil.copy2(cover, dest_dir / f"cover{cover.suffix.lower()}")

    return {
        "audio_url": audio_url,
        "cover_url": f"static/podcast/cover{cover.suffix.lower()}" if cover else None,
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


def load_matches():
    path = CONTENT_DIR / "matches.json"
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
                m["kickoff_local"] = dt_local.strftime("%d/%m à %Hh%M")
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
        "ticker": articles[:10],
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
    hero_slides = articles[:5]
    trending = articles[:TRENDING_COUNT]

    canaf_all = [a for a in articles if a["category_slug"] == "can-caf"]
    maroc_articles = [a for a in canaf_all if _matches_keywords(a, MAROC_KEYWORDS)][:4]
    canaf_articles = canaf_all[:6]

    monde_articles = [a for a in articles if a["category_slug"] == "football-mondial"][:6]
    fc26_articles = [a for a in articles if a["category_slug"] == "fc26"][:4]
    mercato_articles = [a for a in articles if a["category_slug"] == "transferts"][:4]

    quiz_themes_home = load_quiz_themes()
    quiz_popular_theme = quiz_themes_home[0] if quiz_themes_home else None

    tpl = env.get_template("index.html")
    html = tpl.render(
        **common,
        root="",
        canonical_path="/",
        active_nav="home",
        hero_slides=hero_slides,
        trending=trending,
        fc26_articles=fc26_articles,
        mercato_articles=mercato_articles,
        canaf_articles=canaf_articles,
        maroc_articles=maroc_articles,
        monde_articles=monde_articles,
        quiz_popular_theme=quiz_popular_theme,
    )
    (DIST_DIR / "index.html").write_text(html, encoding="utf-8")

    # ---------- Blog (posts rédigés manuellement par le propriétaire,
    # tagués [BLOG] via Telegram — voir agents/blog_agent.py côté pipeline.
    # Ne contient PAS les news du pipeline automatique (can-caf /
    # football-mondial / transferts) : celles-ci restent uniquement sur
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

    # ---------- Page Matchs du jour ----------
    matches_updated_at, matches = load_matches()
    tpl = env.get_template("matches.html")
    html = tpl.render(
        **common,
        root="",
        canonical_path="/matchs.html",
        active_nav="matchs",
        matches=matches,
        matches_updated_at=matches_updated_at,
    )
    (DIST_DIR / "matchs.html").write_text(html, encoding="utf-8")

    # ---------- Page Atlas Quiz ----------
    quiz_ranks = load_quiz_ranks()
    quiz_question_count = load_quiz_question_count()
    quiz_themes = load_quiz_themes()
    tpl = env.get_template("quiz.html")
    html = tpl.render(
        **common,
        root="",
        canonical_path="/quiz.html",
        active_nav="quiz",
        quiz_ranks=quiz_ranks,
        quiz_question_count=quiz_question_count,
        quiz_themes=quiz_themes,
    )
    (DIST_DIR / "quiz.html").write_text(html, encoding="utf-8")

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

    # ---------- sitemap.xml ----------
    today_iso = date.today().isoformat()
    url_entries = [("/", today_iso), ("/blog.html", today_iso)]
    url_entries += [(f"/article/{a['slug']}.html", a["date"]) for a in articles]
    url_entries += [(f"/categorie/{c['slug']}.html", today_iso) for c in config["categories"]]
    url_entries += [(f"/{p['slug']}.html", today_iso) for p in config["static_pages"]]
    url_entries += [("/matchs.html", today_iso)]
    url_entries += [("/quiz.html", today_iso)]
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

    print(f"✅ Site généré dans {DIST_DIR} — {len(articles)} article(s).")


if __name__ == "__main__":
    build()
