# Agent News — Publishing Instructions

This document explains how a human or an **autonomous agent** publishes content
to Agent News. Agent News maintains **three independent lists** on the home
page, and every published item ends up in exactly one of them.

> Agents reading this document: this file is the authoritative contract. Do
> not infer behaviour from screenshots or sample data — follow this guide
> literally. When in doubt, prefer leaving a field empty rather than
> fabricating one.

---

## 1. The three lists

| List         | What it contains                                                   | Backing file        | CLI               | `--category` value |
|--------------|--------------------------------------------------------------------|---------------------|-------------------|--------------------|
| **AI-News**  | Non-technical AI news. May be **videos** or **articles**. Mixed.   | `data/catalog.json` (videos) + `data/links.json` (articles) | `publish-article` or `publish-link` | `ai-news` |
| **Deep Dives** | Technical AI **videos**. Self-hosted byte-identical HTML snapshots of YouTube deep dives. | `data/catalog.json` | `publish-article` | `deep-dive` (default) |
| **Articles** | Curated technical/general AI **articles** linking to the original publisher. | `data/links.json`  | `publish-link`    | `article` (default) |

Two storage files, two CLIs, three lists. The `--category` flag is the
discriminator that decides which list an entry shows up in.

---

## 2. Clone the repository

```bash
git clone <repo-url> agent-news
cd agent-news
npm install
cp .env.example .env   # then edit .env to set PORT, ARTICLES_DIR, CATALOG_PATH, LINKS_PATH
```

After cloning, verify the toolchain is healthy:

```bash
npm run typecheck   # exits 0
npm test            # 147+ tests should pass
```

---

## 3. The date rule (MANDATORY for agents)

Every item carries a `publishedAt` timestamp. Agent News uses this date on
the card AND for newest-first sorting. Apply this **exact priority** when
choosing the value to pass to `--date`:

1. **YouTube upload date** — for any video, look up the official upload
   timestamp via the YouTube Data API (or the page's `<meta itemprop="datePublished">`
   if the API key is unavailable). The CLI will also auto-fetch this into the
   separate `youtubePublishedAt` field when `YOUTUBE_API_KEY` is set; you
   should still pass `--date` with the same value so the card's primary
   date is correct even when API enrichment fails.
2. **Original publication date on the source site** — for an article, use
   the date the article was first published by its original publisher
   (`<meta property="article:published_time">`, `og:article:published_time`,
   `datePublished` in JSON-LD, or a visible byline date).
3. **Fallback — date the item was published on Agent News** — only when
   neither (1) nor (2) can be determined. This is what the CLI does
   automatically when you omit `--date`. Treat this as a last resort.

The `--date` value MUST be a full ISO-8601 datetime with a timezone
designator. Acceptable forms:

```
2025-11-12T09:00:00Z
2025-11-12T11:00:00+02:00
2025-11-12T11:00:00.000+02:00
```

Reject anything else.

> Agents: never set `--date` to "today" when the upstream date is knowable.
> If you cannot find the upstream date with confidence, omit `--date` and
> let the CLI stamp "now" — that is the documented fallback.

---

## 4. The title rule

The **title** is the human-readable headline shown on the card.

- **For videos (publish-article):** the title is **auto-extracted** from
  the source HTML's `<title>` element (or the first `<h1>` if `<title>` is
  empty). You do **not** pass `--title` — the source HTML carries it. To
  get a good title onto the site, give the source HTML a good `<title>`
  before publishing. The video's slug is derived from this title.
- **For articles (publish-link):** the title is **auto-extracted** from
  the page's `og:title`, then `<title>`, then the first `<h1>`. If you
  need to override (e.g. the source page has a clickbait title), pass
  `--title "Your preferred title"`.

Title formatting conventions used across the site:

- Sentence case or Title Case is acceptable — match the source.
- Use em-dashes (`—`) not hyphens when separating clauses.
- Keep titles under ~120 characters; longer titles will wrap awkwardly on
  small cards.
- Do **not** include site-name suffixes like "— YouTube" or "| The
  Verge"; strip them before publishing.

---

## 5. The image (thumbnail) rule

Every card shows one image. The rules differ per list:

### Video entries (`publish-article`)

1. **Preferred — embedded in the HTML.** If the source HTML contains an
   `<img>` tag (the YouTube `maxresdefault.jpg` thumbnail is typical for
   deep-dive snapshots), the first `<img>`'s `src` is used automatically.
   The catalog records `thumbnailSource: "html"`.
2. **Fallback — CLI override.** If the source HTML has no `<img>`, you
   must pass `--thumbnail-url <absolute URL>`. The catalog records
   `thumbnailSource: "cli-override"`. The URL **must be absolute** and
   reachable.
3. **For YouTube videos**, the canonical thumbnail URL pattern is:
   `https://img.youtube.com/vi/<VIDEO_ID>/maxresdefault.jpg`. Use this if
   no other high-quality image is available.

### Article entries (`publish-link`)

1. **Preferred — auto-extracted.** The CLI fetches the source URL and
   reads `og:image`, then `twitter:image`, then the first `<img>` on the
   page. You usually don't need to override.
2. **Override** with `--image-url <absolute URL>` when extraction misses
   or produces a low-quality result.

Image URL MUST be absolute (`http://` or `https://`). Relative or
`data:` URLs are rejected.

---

## 6. Publishing to each list

The `--category` flag controls which homepage list the entry lands in.
Default values: `deep-dive` for videos, `article` for links. Pass
`--category ai-news` for either CLI to move an entry into the mixed
AI-News list instead.

### 6a. Publish to **Deep Dives** (technical AI videos)

```bash
npm run publish-article -- \
  --source "path/to/deep-dive-snapshot.html" \
  --date "2025-11-12T09:00:00Z"
# --category defaults to "deep-dive"; you may also pass it explicitly.
```

### 6b. Publish to **Articles** (curated external articles)

```bash
npm run publish-link -- \
  --url "https://example.com/some-ai-article" \
  --date "2025-11-12T09:00:00Z"
# --category defaults to "article"; you may also pass it explicitly.
```

If extraction misses fields:

```bash
npm run publish-link -- \
  --url "https://example.com/some-ai-article" \
  --title "Building a multi-agent pipeline" \
  --image-url "https://example.com/cover.jpg" \
  --summary "A practical walk-through ..." \
  --date "2025-11-12T09:00:00Z"
```

### 6c. Publish to **AI-News** (non-technical, mixed)

A video that belongs in AI-News (e.g. a non-technical AI news roundup):

```bash
npm run publish-article -- \
  --source "path/to/ai-news-snapshot.html" \
  --category ai-news \
  --date "2025-11-12T09:00:00Z"
```

An article that belongs in AI-News (e.g. a mainstream-press AI story):

```bash
npm run publish-link -- \
  --url "https://nytimes.com/some-ai-story" \
  --category ai-news \
  --date "2025-11-12T09:00:00Z"
```

The AI-News section on the home page merges these two streams and sorts
them newest-first by their `publishedAt` (videos prefer
`youtubePublishedAt` when present).

---

## 7. What ends up in the catalog file (reference)

Agents that bypass the CLI and edit `data/catalog.json` or `data/links.json`
directly must respect the schema below. **The CLI is the supported path**;
direct edits are an escape hatch only.

### `data/catalog.json` — CatalogEntry (videos)

```jsonc
{
  "slug":            "kebab-case-id-derived-from-title",           // required, unique
  "title":           "Human-readable title",                       // required
  "publishedAt":     "2025-11-12T09:00:00.000Z",                   // required, ISO-8601 UTC
  "sourcePath":      "samples/source.html",                        // required, project-relative or absolute
  "articlePath":     "articles/<slug>.html",                       // required
  "thumbnailUrl":    "https://img.youtube.com/vi/<id>/maxresdefault.jpg", // required, absolute
  "thumbnailSource": "html",                                       // "html" or "cli-override"
  "sha256":          "<64-char lowercase hex>",                    // required, of articles/<slug>.html bytes
  "youtubePublishedAt": "2025-11-12T08:55:12.000Z",                // optional, set automatically when possible
  "category":        "ai-news"                                     // optional; omit for "deep-dive"
}
```

### `data/links.json` — LinkEntry (articles)

```jsonc
{
  "id":          "kebab-case-id-derived-from-title",  // required, unique
  "title":       "Human-readable title",              // required
  "url":         "https://publisher.com/article",     // required, absolute http(s)
  "imageUrl":    "https://publisher.com/cover.jpg",   // required, absolute http(s)
  "summary":     "Short description.",                // optional
  "sourceSite":  "publisher.com",                     // required, hostname
  "publishedAt": "2025-11-12T09:00:00.000Z",          // required, ISO-8601 UTC
  "category":    "ai-news"                            // optional; omit for "article"
}
```

After any direct edit, run `npm run typecheck` and start the dev server
(`npm run dev`) — invalid JSON or schema violations will be reported on
load.

---

> **Moving an item between Agent News and Agent News Experimental?** Do
> NOT use the unpublish steps below in isolation — see
> [`./MIGRATING-CONTENT.md`](./MIGRATING-CONTENT.md) for the paired
> destination-write + source-remove recipe that keeps both manifests
> consistent.

## 8. Unpublishing — remove an item from any of the three lists

There is currently **no `unpublish-*` CLI**. Unpublishing is a manual
operation against the same catalog/links files the publish CLIs write to.
Follow this procedure literally — partial removals (catalog entry deleted
but article file orphaned, or vice versa) will break the byte-identity
verification in `scripts/build-static.ts` and the CI deploy will fail.

The procedure differs by *what kind of item* you are removing, not by
which list it currently appears in. The `category` field only decides
which list renders the item; the storage file is decided by item kind.

| Item kind                            | Storage file        | Identifier key | Article file to delete                |
|--------------------------------------|---------------------|----------------|---------------------------------------|
| Video (deep dive OR AI-News video)   | `data/catalog.json` | `slug`         | `articles/<slug>.html` (MUST delete)  |
| Link (article OR AI-News link)       | `data/links.json`   | `id` (or `url`)| none                                  |

### 8a. Identify the item

```bash
# Videos (in catalog.json). Inspect by slug or by title substring:
jq '.entries[] | select(.slug == "deep-dive-handoff-is-my-new-favourite-skill-matt-pocock")' data/catalog.json
jq '.entries[] | select(.title | test("Hermes"; "i"))' data/catalog.json

# Links (in links.json). Inspect by id or by url:
jq '.entries[] | select(.id == "the-unreasonable-effectiveness-of-html")' data/links.json
jq '.entries[] | select(.url == "https://claude.com/blog/...")' data/links.json
```

Confirm the entry's `category` so you know which list it currently
appears in — but it does NOT change where you delete from.

### 8b. Unpublish a video (deep dive or AI-News video)

Remove the entry from `data/catalog.json` **and** delete the corresponding
HTML file. Both steps are required. Use `jq` to keep the JSON well-formed
and to refresh `updatedAt`:

```bash
SLUG="deep-dive-slug-to-remove"

# 1. Remove the catalog entry + bump updatedAt atomically via a tmp file.
jq --arg slug "$SLUG" --arg now "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" '
  .entries |= map(select(.slug != $slug))
  | .updatedAt = $now
' data/catalog.json > data/catalog.json.tmp \
  && mv data/catalog.json.tmp data/catalog.json

# 2. Delete the published article file.
rm "articles/${SLUG}.html"

# 3. Verify byte-identity still holds for everything that remains.
npm run typecheck
npm test
```

> If you skip step 2, the next `build:static` will throw
> `Article file missing on disk for catalog entry "<slug>"`. If you skip
> step 1, the next build will throw an SHA-256 mismatch the moment the
> article is regenerated, OR the orphan file will silently ship without a
> card. Always do BOTH.

### 8c. Unpublish a link (article or AI-News link)

```bash
ID="link-id-to-remove"
# Or, if you have the URL but not the id:
# URL="https://publisher.com/some-article"

jq --arg id "$ID" --arg now "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" '
  .entries |= map(select(.id != $id))
  | .updatedAt = $now
' data/links.json > data/links.json.tmp \
  && mv data/links.json.tmp data/links.json

npm run typecheck
npm test
```

No file on disk to delete — links never copy the article body.

### 8d. Re-categorise vs. unpublish

Moving an item between AI-News and Deep Dives (or AI-News and Articles)
is **not** an unpublish. Use the publish CLI's `--update` path instead so
the entry's identity (`slug` / `id` / `publishedAt`) is preserved:

```bash
# Move a video from AI-News into Deep Dives:
npm run publish-article -- --source "<original source path>" --update --category deep-dive

# Move a link from Articles into AI-News:
npm run publish-link -- --url "<original URL>" --update --category ai-news
```

### 8e. After any unpublish — commit + push

The unpublish is only "live" after the static-deploy workflow runs:

```bash
git add data/catalog.json data/links.json articles/    # `articles/` for the deletion
git status                                             # confirm scope
git commit -m "Unpublish: <human description of the item>"
git push origin main
```

CI rebuilds `dist/` from the post-removal state, the deploy job promotes
the new artifact, and the site reflects the removal within a minute or
two of the push completing.

---

## 9. Rebuild the static site

After publishing, regenerate the static export consumed by GitHub Pages:

```bash
CATALOG_PATH=./data/catalog.json \
ARTICLES_DIR=./articles \
LINKS_PATH=./data/links.json \
BASE_PATH="" \
OUT_DIR=./dist \
npm run build:static
```

The output is written to `dist/`:
- `dist/index.html` — three sections (AI-News → Deep Dives → Articles)
- `dist/a/<slug>.html` — byte-identical copy of each video article
- `dist/404.html`, `dist/.nojekyll`

---

## 10. Checklist for agents

Before invoking the publish CLI, confirm:

- [ ] Decided which of the three lists this item belongs to (AI-News / Deep Dives / Articles).
- [ ] Picked the correct CLI (`publish-article` for videos, `publish-link` for articles).
- [ ] Resolved the **upstream publication date** (YouTube upload date or original article date); fall back to "now" only when truly unknown.
- [ ] Title is clean (no site-suffix, under ~120 chars, no clickbait noise).
- [ ] Image URL is absolute and reachable.
- [ ] `--category` is set when targeting AI-News (the default for the other two lists is correct).
- [ ] `npm run typecheck` and `npm test` are green before pushing.

Before unpublishing (§8), confirm:

- [ ] Identified the right kind of item — video → `data/catalog.json` (delete `articles/<slug>.html` too), link → `data/links.json` (no file delete).
- [ ] The intent is removal — not re-categorisation; if just moving lists, use `--update --category` instead (§8d).
- [ ] Captured the entry's `slug`/`id` for the commit message and for any rollback that might be needed.
- [ ] Confirmed `npm run typecheck` and `npm test` still pass after the deletion, BEFORE pushing.

---

## 11. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `ALREADY_PUBLISHED` (exit 3) | Slug or URL already exists. | Pass `--update` if the intent is to replace; otherwise pick a different source. |
| `NO_THUMBNAIL` (exit 1) | Source HTML has no `<img>`. | Pass `--thumbnail-url <absolute URL>`. |
| `NO_IMAGE` (exit 1) on a link | The fetched page exposes no `og:image`/`twitter:image`/`<img>`. | Pass `--image-url <absolute URL>`. |
| `Invalid --date` (exit 1) | Date is not full ISO-8601 with timezone. | Use `2025-11-12T09:00:00Z` or `…+02:00`. |
| `Invalid --category` (exit 1) | Value is not `deep-dive`/`ai-news` (article CLI) or `article`/`ai-news` (link CLI). | Use one of the documented values. |
| Card appears in the wrong list | `--category` was wrong / missing on `--update`. | Re-run with `--update --category <correct>` to fix in place. |
| `Article file missing on disk for catalog entry "<slug>"` during `build:static` | Catalog entry kept but `articles/<slug>.html` was deleted (incomplete unpublish). | Either restore the file from git (`git checkout HEAD -- articles/<slug>.html`) OR finish the unpublish by removing the catalog entry too (§8b). |
| SHA-256 mismatch during `build:static` | The article file changed on disk but the catalog `sha256` was not updated. | Re-publish with `--update`, OR if removing, finish the unpublish (§8b). |
| Item removed from `data/*.json` but still appears on the live site | CI hasn't redeployed yet; or the commit only edited JSON and forgot to delete the article file. | Wait for the `Deploy to GitHub Pages` workflow to finish on `main`; then confirm `articles/<slug>.html` is also gone for video unpublishes. |
