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

import json
import shutil
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

TRENDING_COUNT = 5   # nombre d'articles affichés dans le bloc "Tendances"
RELATED_COUNT = 4    # nombre d'articles affichés dans "À lire aussi"


def load_config():
    with open(CONTENT_DIR / "config.json", encoding="utf-8") as f:
        return json.load(f)


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


def load_articles():
    articles = []
    for path in sorted(ARTICLES_DIR.glob("*.json")):
        with open(path, encoding="utf-8") as f:
            articles.append(json.load(f))
    # tri du plus récent au plus ancien
    articles.sort(key=lambda a: a["date"], reverse=True)
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
        "today": date.today().strftime("%d/%m/%Y"),
        "year": date.today().year,
    }

    # ---------- Page d'accueil ----------
    lead = articles[0] if articles else None
    rest = articles[1:] if len(articles) > 1 else []
    trending = articles[:TRENDING_COUNT]

    tpl = env.get_template("index.html")
    html = tpl.render(
        **common,
        root="",
        canonical_path="/",
        active_nav="home",
        lead=lead,
        articles=rest,
        trending=trending,
    )
    (DIST_DIR / "index.html").write_text(html, encoding="utf-8")

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

    # ---------- Fichiers statiques (css, images) ----------
    shutil.copytree(STATIC_DIR, DIST_DIR / "static", dirs_exist_ok=True)

    # ---------- sitemap.xml ----------
    today_iso = date.today().isoformat()
    url_entries = [("/", today_iso)]
    url_entries += [(f"/article/{a['slug']}.html", a["date"]) for a in articles]
    url_entries += [(f"/categorie/{c['slug']}.html", today_iso) for c in config["categories"]]
    url_entries += [(f"/{p['slug']}.html", today_iso) for p in config["static_pages"]]
    url_entries += [("/matchs.html", today_iso)]
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
