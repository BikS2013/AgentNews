# Migrating content between Agent News and Agent News Experimental

This document is the agent-facing contract for **moving an item from one
site to the other** — public ↔ experimental, in either direction.

It is the move-direction companion to `docs/PUBLISHING.md` (publish) and
to `§8` of that same file (unpublish). Read those first if you have not.

> **Read this before you start.** Every migration is a *destination write
> + source removal* pair. Doing only one half breaks byte-identity
> verification in `build:static` / `build:experimental`, or leaves an
> orphan HTML file the next deploy will choke on. Always do BOTH halves.

---

## 1. The map: which area maps to which storage

There are exactly two **kinds** of items and four **areas per site**. Storage
is decided by the kind. The `category` field decides which area the item
appears in.

| Item kind | Public storage              | Experimental storage                  | HTML file?                              |
|-----------|-----------------------------|---------------------------------------|-----------------------------------------|
| Video     | `data/catalog.json`         | `data/experimental-catalog.json`      | yes — `articles/<slug>.html` (public) / `experimental/<slug>.html` (experimental) |
| Link      | `data/links.json`           | `data/experimental-links.json`        | no                                      |

Areas on each site and the `category` value that places an item there:

| Area on the rendered page | Public `category` values         | Experimental `category` values            |
|---------------------------|----------------------------------|-------------------------------------------|
| AI-News                   | video: `ai-news`, link: `ai-news`| video: `ai-news`, link: `ai-news`         |
| Deep Dives                | video: `deep-dive` (default)     | video: `deep-dive` (default)              |
| Tools                     | *(does not exist on public)*     | video: `tools`                            |
| Articles                  | link: `article` (default)        | link: `article` (default)                 |

> **Asymmetry to remember.** The `tools` category is **experimental-only**.
> Moving a `tools` entry experimental → public REQUIRES re-categorising it
> to `deep-dive` or `ai-news` during the move; otherwise the public
> `CatalogStore` will reject the manifest on load and the public deploy
> will fail.

---

## 2. The universal recipe

Every migration follows the same four steps. The details of step 1 / step 2
differ by item kind (video vs. link).

| # | Step                                                                       | Why                                                          |
|---|----------------------------------------------------------------------------|--------------------------------------------------------------|
| 1 | **Write to the destination** (new HTML file + new manifest entry).         | Materialise the item on the target side first.               |
| 2 | **Remove from the source** (delete HTML file + remove manifest entry).     | Avoid two copies. Avoid orphan HTML files.                   |
| 3 | **Verify** (`npm run typecheck && npm test`).                              | Catches schema/byte-identity regressions before push.        |
| 4 | **Commit + push.**                                                         | Both deploy workflows are triggered by path-filtered pushes. |

> Steps 1 and 2 must both land in the **same commit**. A push that contains
> only step 1 (or only step 2) puts the repo in a half-migrated state where
> the next build can fail.

---

## 3. Identifying the item

Before moving anything, locate the entry on the source side. The
identifier you use depends on the kind:

```bash
# Video — by slug:
jq '.entries[] | select(.slug == "deep-dive-handoff-is-my-new-favourite-skill-matt-pocock")' data/catalog.json
# Video — by title substring (case-insensitive):
jq '.entries[] | select(.title | test("Hermes"; "i"))' data/catalog.json

# Experimental video — same shape, different file:
jq '.entries[] | select(.slug == "<slug>")' data/experimental-catalog.json

# Link — by id or url:
jq '.entries[] | select(.id == "the-unreasonable-effectiveness-of-html")' data/links.json
jq '.entries[] | select(.url == "https://claude.com/blog/...")' data/links.json
```

Capture three fields from the source entry before you delete it:

- `slug` (videos) or `id` (links)
- `publishedAt` — copy this VERBATIM so the destination preserves the
  original timestamp instead of resetting to "now".
- `category` — decide whether you keep it or change it on the destination.

---

## 4. Public → Experimental

### 4a. Video: Public Deep Dive → Experimental Deep Dive (same category)

The cleanest path uses the destination CLI for the write half and `jq` for
the remove half.

```bash
# --- Step 1: write to the experimental side via the CLI ---
SLUG="deep-dive-slug-on-public"
ORIGINAL_DATE="$(jq -r --arg slug "$SLUG" '.entries[] | select(.slug == $slug) | .publishedAt' data/catalog.json)"

EXPERIMENTAL_DIR=./experimental \
EXPERIMENTAL_CATALOG_PATH=./data/experimental-catalog.json \
  npm run publish-experimental-article -- \
    --source "articles/${SLUG}.html" \
    --date "$ORIGINAL_DATE" \
    --category deep-dive

# --- Step 2: unpublish from the public side ---
jq --arg slug "$SLUG" --arg now "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" '
  .entries |= map(select(.slug != $slug))
  | .updatedAt = $now
' data/catalog.json > data/catalog.json.tmp \
  && mv data/catalog.json.tmp data/catalog.json

rm "articles/${SLUG}.html"

# --- Step 3: verify ---
npm run typecheck
npm test
```

> The CLI derives the destination slug from the article title. If the
> public-side slug was suffixed because of a slug collision (e.g.
> `foo-bar-2`), the experimental-side slug will be the base form (`foo-bar`).
> That is fine — slugs are catalog-local.

### 4b. Video: Public Deep Dive → Experimental Tools (category changes)

Exactly the same as 4a, but pass `--category tools` to the destination CLI:

```bash
EXPERIMENTAL_DIR=./experimental \
EXPERIMENTAL_CATALOG_PATH=./data/experimental-catalog.json \
  npm run publish-experimental-article -- \
    --source "articles/${SLUG}.html" \
    --date "$ORIGINAL_DATE" \
    --category tools
```

> The experimental site renders Tools between Deep Dives and Articles.
> See [`./design/project-design.md`](./design/project-design.md) §
> "Experimental Sibling Publish".

### 4c. Video: Public AI-News video → any experimental area

AI-News videos live in `data/catalog.json` with `category: "ai-news"`. The
move is identical to 4a, except you pick the destination category at write
time:

| Destination area on experimental | Pass to the destination CLI |
|----------------------------------|-----------------------------|
| AI-News                          | `--category ai-news`        |
| Deep Dives                       | `--category deep-dive`      |
| Tools                            | `--category tools`          |

The unpublish half (Step 2) is identical to 4a — videos always come from
`data/catalog.json` regardless of which area they were in.

### 4d. Link: Public Article → Experimental Article

Links live only in JSON — no HTML file is copied. There is **no
`publish-experimental-link` CLI yet** (see
[`../Issues - Pending Items.md`](../Issues%20-%20Pending%20Items.md)),
so the destination write is a hand-edited `jq` operation.

```bash
# Capture the entire source entry from public links.json.
ID="link-id-to-move"
ENTRY="$(jq --arg id "$ID" '.entries[] | select(.id == $id)' data/links.json)"

# Optional: change category to 'article' (default for Articles area).
# If you want it in experimental's Articles area, keep category as 'article'
# (or unset). If you want experimental AI-News, set 'ai-news'.
NEW_CATEGORY="article"  # or "ai-news"
ENTRY="$(echo "$ENTRY" | jq --arg cat "$NEW_CATEGORY" '.category = $cat')"

# --- Step 1: append to experimental-links.json + bump updatedAt ---
jq --argjson e "$ENTRY" --arg now "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" '
  .entries += [$e]
  | .updatedAt = $now
' data/experimental-links.json > data/experimental-links.json.tmp \
  && mv data/experimental-links.json.tmp data/experimental-links.json

# --- Step 2: remove from public links.json + bump updatedAt ---
jq --arg id "$ID" --arg now "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" '
  .entries |= map(select(.id != $id))
  | .updatedAt = $now
' data/links.json > data/links.json.tmp \
  && mv data/links.json.tmp data/links.json

# --- Step 3: verify ---
npm run typecheck
npm test
```

> **Schema parity is your friend here.** The public `LinkEntry` and the
> experimental `LinkEntry` are the same shape — both files use the same
> validator. Copying an entry across with category retained (or remapped
> to a valid value) always satisfies the schema.

### 4e. Link: Public AI-News link → any experimental area

Same recipe as 4d. The only difference is which `NEW_CATEGORY` you set on
the destination entry:

| Destination area on experimental | `NEW_CATEGORY` to set on the link entry |
|----------------------------------|------------------------------------------|
| AI-News                          | `ai-news`                                |
| Articles                         | `article` (or unset — `article` is the default) |

Links cannot be moved into Deep Dives or Tools — those areas are
video-only on both sites.

---

## 5. Experimental → Public

The mechanics mirror Section 4 with the two flows swapped. The one thing
that changes is the **category compatibility check** in step 1.

> **Category check before you move.** The public flow accepts ONLY
> `deep-dive` / `ai-news` for videos and `article` / `ai-news` for links.
> If the experimental entry's category is `tools`, you MUST pick one of
> the public-valid categories before writing to the public side, or the
> public deploy will reject the manifest on its next load.

### 5a. Video: Experimental Deep Dive → Public Deep Dive (same category)

```bash
SLUG="experimental-slug-to-move"
ORIGINAL_DATE="$(jq -r --arg slug "$SLUG" '.entries[] | select(.slug == $slug) | .publishedAt' data/experimental-catalog.json)"

# --- Step 1: write to the public side via the CLI ---
PORT=3000 \
ARTICLES_DIR=./articles \
CATALOG_PATH=./data/catalog.json \
LINKS_PATH=./data/links.json \
  npm run publish-article -- \
    --source "experimental/${SLUG}.html" \
    --date "$ORIGINAL_DATE" \
    --category deep-dive

# --- Step 2: unpublish from the experimental side ---
jq --arg slug "$SLUG" --arg now "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" '
  .entries |= map(select(.slug != $slug))
  | .updatedAt = $now
' data/experimental-catalog.json > data/experimental-catalog.json.tmp \
  && mv data/experimental-catalog.json.tmp data/experimental-catalog.json

rm "experimental/${SLUG}.html"

# --- Step 3: verify ---
npm run typecheck
npm test
```

> `publish-article` requires `PORT`, `ARTICLES_DIR`, `CATALOG_PATH`,
> `LINKS_PATH` in its environment. The values shown match the project
> defaults; copy them from `.env.example` if you maintain a local `.env`.

### 5b. Video: Experimental Tools → Public (category MUST change)

Public has no Tools area. Decide before you move whether the item belongs
in public Deep Dives or public AI-News.

```bash
# Pass either --category deep-dive OR --category ai-news (NOT tools).
PORT=3000 \
ARTICLES_DIR=./articles \
CATALOG_PATH=./data/catalog.json \
LINKS_PATH=./data/links.json \
  npm run publish-article -- \
    --source "experimental/${SLUG}.html" \
    --date "$ORIGINAL_DATE" \
    --category deep-dive   # or: ai-news
```

If you accidentally try `--category tools`, the public CLI rejects it
with `Invalid --category: "tools". Allowed values: deep-dive, ai-news`
and exits 1 BEFORE writing anything — by design.

Step 2 (unpublish from experimental) is identical to 5a.

### 5c. Video: Experimental AI-News video → any public area

Mirror of 4c, with `publish-article` instead of
`publish-experimental-article` for the destination write.

### 5d. Link: Experimental Article → Public Article

Mirror of 4d, with the source/destination JSON files swapped. There IS a
`publish-link` CLI for the public side, but it ingests a URL — for a pure
move you want to preserve all the existing metadata bytes (publishedAt,
sha-like fields, og snapshot), so the `jq` recipe is preferred:

```bash
ID="link-id-to-move"
ENTRY="$(jq --arg id "$ID" '.entries[] | select(.id == $id)' data/experimental-links.json)"

# Make sure category is valid for the public flow (article or ai-news).
NEW_CATEGORY="article"  # or "ai-news"
ENTRY="$(echo "$ENTRY" | jq --arg cat "$NEW_CATEGORY" '.category = $cat')"

# --- Step 1: append to public links.json ---
jq --argjson e "$ENTRY" --arg now "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" '
  .entries += [$e]
  | .updatedAt = $now
' data/links.json > data/links.json.tmp \
  && mv data/links.json.tmp data/links.json

# --- Step 2: remove from experimental-links.json ---
jq --arg id "$ID" --arg now "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" '
  .entries |= map(select(.id != $id))
  | .updatedAt = $now
' data/experimental-links.json > data/experimental-links.json.tmp \
  && mv data/experimental-links.json.tmp data/experimental-links.json

# --- Step 3: verify ---
npm run typecheck
npm test
```

### 5e. Link: Experimental AI-News link → any public area

Same recipe as 5d with `NEW_CATEGORY=ai-news` if you want it in public
AI-News, or `article` for public Articles.

---

## 6. Common pitfalls (read this BEFORE you start)

1. **Half-migrations break the build.** A commit that adds the
   destination entry but leaves the source one in place creates a
   duplicate slug rendered on both sites. A commit that removes the
   source entry but forgets to delete the source HTML file produces an
   orphan that the next deploy may or may not catch depending on whether
   the file is referenced anywhere. **Always do both halves in one
   commit.**

2. **`publishedAt` drifts to "now" if you forget `--date`.** The CLI
   defaults to `new Date().toISOString()` when no `--date` is given. For
   moves you almost always want the original timestamp. Capture it with
   `jq -r '.entries[] | select(.slug == ...) | .publishedAt'` BEFORE
   the source-side delete.

3. **`tools` is experimental-only.** Public CatalogStore rejects
   `category: "tools"` on load. The public CLI rejects `--category tools`
   at write time. If you try to move a Tools entry to public without
   re-categorising, BOTH guard rails fire and protect the public site.

4. **Links have no HTML file.** Do NOT `rm` anything from `articles/`
   or `experimental/` for a link migration. Links are pure manifest
   entries.

5. **There is no `publish-experimental-link` CLI yet.** Link migrations
   into the experimental side use the `jq` recipe in §4d / §5d. See
   `Issues - Pending Items.md` for the open follow-up.

6. **Build SHA-256 mismatch.** If you `mv` the HTML file by hand and the
   destination catalog entry's `sha256` doesn't match the on-disk file's
   actual hash, `build:experimental` / `build:static` will throw
   `SHA-256 mismatch for "<slug>"` and abort. Always use the destination
   CLI for the write half when possible — it recomputes sha256 from the
   file it just wrote.

7. **Slug collisions on the destination side.** If you publish to a
   destination whose catalog already contains the same base slug from a
   different source, the CLI will either suffix the slug (new publish)
   or refuse with `ALREADY_PUBLISHED` (exit 3) if the title also matches.
   Use `--update` if the existing destination entry is actually the same
   article you are migrating.

---

## 7. After the migration — verify, commit, push

Both deploy workflows are path-filtered. Knowing which one your commit
will trigger:

| Files touched in the commit                                  | `deploy.yml` (public) | `publish-experimental.yml` (experimental) |
|--------------------------------------------------------------|-----------------------|-------------------------------------------|
| `articles/**`, `data/catalog.json`, `data/links.json`        | YES                   | no                                        |
| `experimental/**`, `data/experimental-*.json`                | no                    | YES                                       |
| BOTH (any cross-flow migration)                              | YES                   | YES                                       |

A typical migration commit triggers BOTH workflows because it changes
both trees. Two deploys run in parallel; the public site rebuilds without
the moved item, the experimental site rebuilds with it (or vice versa).

```bash
# Final checks
npm run typecheck
npm test

# Stage exactly the migrated paths — never `git add -A` here.
git add data/catalog.json data/experimental-catalog.json \
        articles/<slug-removed>.html experimental/<slug-added>.html
# ... or for links:
git add data/links.json data/experimental-links.json

git commit -m "Move <title> from <source-area> to <destination-area>"
git push origin main
```

---

## 8. Quick reference table

| From (Agent News)              | To (Agent News Experimental)         | Section |
|--------------------------------|--------------------------------------|---------|
| Deep Dives                     | Deep Dives                           | §4a     |
| Deep Dives                     | Tools                                | §4b     |
| Deep Dives                     | AI-News                              | §4c     |
| AI-News (video)                | Deep Dives / AI-News / Tools         | §4c     |
| Articles                       | Articles / AI-News                   | §4d     |
| AI-News (link)                 | Articles / AI-News                   | §4e     |

| From (Agent News Experimental) | To (Agent News)                       | Section |
|--------------------------------|---------------------------------------|---------|
| Deep Dives                     | Deep Dives                            | §5a     |
| Tools (MUST recategorise)      | Deep Dives or AI-News                 | §5b     |
| AI-News (video)                | Deep Dives / AI-News                  | §5c     |
| Articles                       | Articles / AI-News                    | §5d     |
| AI-News (link)                 | Articles / AI-News                    | §5e     |
