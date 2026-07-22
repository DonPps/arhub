# Guide SEO éditorial — pour le prompt de l'agent de génération d'articles

Le SEO technique (sitemap, balises meta, JSON-LD, canonical) est déjà géré
par le générateur. Ce qui suit doit être respecté par l'agent au moment de
la RÉDACTION de chaque article, car ça ne peut pas se corriger après coup
sans réécrire le texte.

## Titre (`title`)
- 50-60 caractères maximum (au-delà, Google le tronque dans les résultats de recherche)
- Contient le mot-clé principal le plus tôt possible dans la phrase
- Pas de clickbait vide ("Vous ne devinerez jamais...") — Google et les lecteurs pénalisent ça

## Chapô (`dek`)
- 140-160 caractères — sert de meta description, donc c'est ce qui s'affiche sous le lien dans Google
- Doit donner une vraie raison de cliquer, pas juste répéter le titre

## Corps de l'article (`body_paragraphs`)
- Le mot-clé principal doit apparaître dans le premier paragraphe
- Utiliser des variantes et synonymes du mot-clé plutôt que le répéter mécaniquement (Google pénalise le bourrage de mots-clés)
- 300-500 mots minimum (déjà la règle pour AdSense, ça sert aussi le SEO — Google favorise le contenu substantiel)
- Phrases courtes, paragraphes courts (3-5 phrases) — meilleure lisibilité = meilleur classement
- Pour Maroc 2030 : inclure des noms de lieux précis (quartiers, montagnes, sites) plutôt que des termes génériques — le SEO local/touristique vit des recherches spécifiques ("riad à Chefchaouen" plutôt que "hôtel au Maroc")

## Tags (`tags`)
- 3-5 tags maximum, spécifiques (pas juste "Maroc" ou "Football" — trop génériques pour être utiles)

## Liens internes
- Quand c'est pertinent, l'agent peut faire un lien HTML vers un autre article déjà publié
  (`<a href="../article/autre-slug.html">texte</a>` dans un paragraphe) — le maillage interne
  aide au référencement et à la durée de visite

## Ce qui est déjà géré techniquement (l'agent n'a pas à s'en soucier)
- Balises meta title/description, canonical, Open Graph, Twitter Card
- JSON-LD NewsArticle (schema.org) pour l'indexation enrichie Google
- sitemap.xml avec date de dernière modification
- robots.txt

## À faire manuellement plus tard (hors scope de l'agent)
- Soumettre le sitemap à Google Search Console une fois le domaine en ligne
- Vérifier la vitesse de chargement (le site étant statique, ça devrait être bon par défaut)
- Textes alternatifs (`alt`) sur les vraies illustrations une fois insérées à la place des placeholders
