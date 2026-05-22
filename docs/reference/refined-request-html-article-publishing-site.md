# Refined Request: HTML Article Publishing Site with Catalog

## Category
Development

## Objective
Design and build a web site (a "content place") that hosts a growing library of self-contained HTML articles and exposes them through a browsable catalog. Each article must be served to readers byte-for-byte identical to its source HTML file (no rewriting, transformation, re-rendering, or content injection). The catalog must list every published article with its publication date, title, and the thumbnail image embedded in the article's HTML, and must link out to the full, unmodified article page.

## Scope

### In scope
- A web-accessible site that hosts and serves a collection of standalone HTML articles (sample corpus: 7 articles in `samples/`, each 23-42 KB, complete `<!DOCTYPE html>` documents with inline `<style>` and inline content).
- A catalog/index page on the site that lists all published articles, showing for each one:
  - Title (extracted from the article's `<title>` tag).
  - Publication date (assigned at publication time).
  - Thumbnail image (the first `<img>` in the article body; in the samples this is a YouTube thumbnail URL such as `https://img.youtube.com/vi/<id>/maxresdefault.jpg`).
  - A link that opens the full article in its original form.
- A persistence mechanism (file-based index, database, or static metadata file -- to be chosen during investigation) that maintains the catalog metadata (title, publication date, thumbnail URL, article slug/path) for every published article.
- A publishing workflow that ingests a new HTML article file and registers it in the catalog. The workflow must extract title and thumbnail automatically from the source HTML and capture the publication date at the moment of publication.
- Serving each article at a stable URL so that fetching the article URL returns the exact bytes of the source HTML file (verifiable with a hash comparison).
- Basic catalog ordering (newest first) and visual presentation suitable for browsing the list of articles.

### Out of scope
- Editing, rewriting, transforming, optimising, minifying, or re-rendering article HTML in any way.
- Injecting analytics, ads, navigation bars, headers, footers, tracking scripts, or any other content into the article HTML at serve time.
- Authentication or user accounts for readers (the site is public-read).
- Comments, likes, reactions, or any social/interaction features.
- Full-text search across article bodies (catalog-level filtering on title/date is acceptable but not required in v1).
- Rich content management UI (CMS dashboard); the publishing workflow can be CLI/script-driven in v1.
- Migration of articles to a different format (Markdown, MDX, JSON, etc.). Articles remain native HTML.
- Multi-tenant or multi-author features.
- Internationalisation/localisation of the catalog UI.

## Requirements

### Functional

1. **Article ingestion**: The system must accept a self-contained HTML file as input and add it to the catalog without modifying the file's content.
2. **Title extraction**: On ingestion, the system must extract the article title from the `<title>` element of the source HTML and store it in the catalog metadata.
3. **Thumbnail extraction**: On ingestion, the system must extract the first `<img src="...">` URL from the article body and store it as the catalog thumbnail. The URL must be stored as-is (the samples reference external YouTube thumbnail URLs; the system must not download or rewrite them).
4. **Publication date capture**: On ingestion, the system must record the publication date/time. The publication date must be displayed in the catalog. The date format displayed to readers must be human-readable (e.g. ISO `YYYY-MM-DD` or a localised long form -- to be decided during design).
5. **Catalog page**: The site must expose a catalog/index page that lists all published articles, each entry showing thumbnail, title, publication date, and a link to the article.
6. **Catalog ordering**: Catalog entries must be ordered by publication date, newest first.
7. **Article serving (byte-identical)**: For each published article, the site must serve the article's HTML content byte-for-byte identical to the source file. The SHA-256 hash of the served response body must equal the SHA-256 hash of the source HTML file.
8. **Stable article URL**: Each article must be reachable at a stable, deterministic URL (slug derived from title or filename) that does not change once published.
9. **Catalog persistence**: The catalog metadata must survive site restarts/redeploys (i.e. it is stored, not held in volatile memory only).
10. **Idempotent re-publishing**: Re-publishing the same article (same source file) must not create a duplicate catalog entry; behaviour on content change (update vs reject) must be explicitly defined in the design.

### Non-functional

11. **Fidelity**: Zero modification of article HTML. No HTTP-level transforms (e.g. no HTML rewriting middleware, no content injection by a CDN). `Content-Type` must be `text/html; charset=utf-8` to match the source files' declared `<meta charset="UTF-8">`.
12. **Maintainability**: The publishing workflow must be simple enough that a single command/script publishes a new article from a file path.
13. **Portability**: The chosen stack should be deployable to common hosting targets (static host, container, or small VM); the investigation phase will compare options.
14. **Performance**: Catalog page must load in under 2 seconds on a typical broadband connection for the first 50 articles. Article pages are served as-is so their performance is governed by their own content.
15. **Reliability**: Adding a new article must not require downtime; existing article URLs must remain valid across publications.

## Constraints

- **Hard fidelity constraint**: Articles must be served exactly as authored. Any solution that requires templating, layout-wrapping, asset rewriting, or HTML post-processing of the article body is non-compliant.
- **Tooling convention**: Per project `CLAUDE.md`, any reusable scripts/utilities created during implementation must be built as TypeScript tools, scaffolded via the `/tool-conventions scaffold <tool-name>` slash command, and documented under `docs/tools/<tool-name>.md`.
- **No fallback for missing config**: Per project convention, if a configuration value (publication date, thumbnail URL, catalog storage location, etc.) is unavailable for an article, the system must raise an explicit error rather than substitute a default.
- **Dependency vetting**: Any runtime dependency added must follow the `<dependency-vetting>` rules in the project `CLAUDE.md` (latest stable major, advisory check, pin with caret range, log vetted-on date).
- **Documentation conventions**: All design artefacts go under `docs/design/`, all reference material under `docs/reference/`, all plans named `plan-NNN-<desc>.md`.
- **Database naming (if a DB is chosen)**: Tables must be singular (`Article`, not `Articles`); join tables follow the `EntityRelations` convention.

## Acceptance Criteria

1. **Catalog displays all published articles**: After publishing the 7 sample articles, the catalog page lists exactly 7 entries.
2. **Catalog entry contents**: For each catalog entry the page renders (a) the correct title taken verbatim from the article's `<title>` tag, (b) the publication date assigned at publication, and (c) the thumbnail image referenced by the first `<img>` in the source HTML.
   - Spot-check for `samples/Deep Dive — _handoff is my new favourite skill (Matt Pocock).html`:
     - Title text shown: `Deep Dive: /handoff is my new favourite skill — Matt Pocock`.
     - Thumbnail src shown: `https://img.youtube.com/vi/dtAJ2dOd3ko/maxresdefault.jpg`.
3. **Byte-identical serving**: For every published article, `sha256(GET /<article-url>)` equals `sha256(<source-file>)`. A test script in `test_scripts/` must verify this for all 7 sample articles and exit non-zero on any mismatch.
4. **Newest-first ordering**: When articles are published on different dates, the catalog displays them ordered by publication date descending.
5. **Stable URLs**: Republishing or restarting the site does not change the URL at which a previously published article is served.
6. **Catalog click-through**: Clicking a catalog entry navigates the reader to the full article served at the article's stable URL.
7. **Persistence across restart**: After restarting the site/service, the catalog still lists every previously published article with its original publication date and metadata.
8. **Publishing workflow**: A documented single command (e.g. `pnpm publish-article <path>` or equivalent) publishes a new HTML file from disk, extracts title and thumbnail, records the publication date, and updates the catalog atomically.
9. **No injection**: Comparing the served article response body to the source file shows zero differences (no inserted `<script>`, no rewritten `src`, no minification whitespace changes).
10. **Idempotency**: Running the publish command twice on the same unchanged file does not produce a second catalog entry.

## Assumptions

- **Self-contained HTML**: Each article is a single, self-contained `<!DOCTYPE html>` document with inline CSS and inline content. External assets (e.g. YouTube thumbnail images) are referenced by absolute URL and the site is NOT expected to mirror or proxy them. Basis: inspection of all 7 files in `samples/` shows no relative asset references; thumbnails are absolute `https://img.youtube.com/...` URLs.
- **First `<img>` is the catalog thumbnail**: The first `<img>` tag in document order corresponds to the article's hero/thumbnail. Basis: confirmed across all 7 samples (e.g. line 237 of the Matt Pocock article, line 221 of the Cooking with Agents article).
- **`<title>` tag is the catalog title**: The text content of `<title>` is the intended catalog title.
- **Publication date is "now"**: When an article is published via the workflow, the publication date defaults to the moment of publication (UTC). If backdating is required, it can be supplied as an optional CLI argument; this is a nice-to-have, not a v1 requirement.
- **Single-author / small-volume**: The site is operated by a single editor and is not expected to handle thousands of articles in v1 (initial corpus is 7, growth in low double-digits per month is the assumption).
- **No reader auth**: Articles are publicly readable.
- **External thumbnail URLs are stable enough**: The catalog stores the external thumbnail URL as-is. If YouTube takes the thumbnail down, the catalog will show a broken image. This is acceptable behaviour for v1 (matches the article's own behaviour, since the article's HTML uses the same URL).
- **Filename is not authoritative**: The catalog title comes from `<title>`, not the filename. Filenames may be used as the basis for URL slugs but the displayed title must come from the HTML.

## Open Questions

1. **Hosting model**: Static-site generator (catalog as pre-built HTML) vs lightweight server (catalog rendered dynamically from a small DB/JSON index) vs headless CMS -- to be decided in the investigation phase.
2. **Catalog storage backing**: Flat JSON manifest in the repo, SQLite file, or a hosted DB -- to be decided in the investigation phase based on hosting model.
3. **Slug strategy**: Derive slug from `<title>` (kebab-cased), from filename, or from a hash/short-id -- to be decided in design.
4. **Content-change policy**: When a re-publish is attempted with modified content for the same article, should the system (a) reject, (b) update in place keeping original publication date, or (c) version the article? -- to be decided in design.
5. **Catalog pagination**: Required only if the corpus grows past ~50 articles; default plan is no pagination in v1.
6. **Backdating publication dates**: Should the publishing workflow accept an explicit publication date for re-imports/migrations? Currently treated as a nice-to-have.
7. **Article deletion / unpublishing**: Out-of-scope for v1 unless the user confirms otherwise.

## Original Request

> I want you to search and suggest a solution so that I can publish HTML articles, similar to those found in the sample folder, on a site.
> I want the site to host the articles and display them in its catalog.
> However, when they are published, they must have exactly the same form they have right now, as HTML content, without altering them at all.
> I want the site to maintain a catalog of the articles that are published, the publication date of each article, its title, and the image that should appear in the article catalog in the site's list. This image is the same one that is found inside the HTML page of the article.

### Provided context (from the orchestrator)
- `samples/` contains 7 self-contained HTML articles (each a complete `<!DOCTYPE html>` document with inline `<style>` and inline content, file sizes 23k-42k).
- Each article has a `<title>` tag with the article's title (e.g. "Deep Dive: /handoff is my new favourite skill — Matt Pocock").
- Each article references a hero/thumbnail image via the first `<img src="...">` tag in the document (in the samples, this points to a YouTube thumbnail URL like `https://img.youtube.com/vi/<id>/maxresdefault.jpg`). This is the image that must appear next to the article in the site's catalog list.
- Hard constraint: articles must be served byte-identical to their source -- no rewriting, no re-rendering, no injection.
- The site must maintain a catalog with: publication date, title, thumbnail image, and a link to view the full article.
- This is a development workflow -- the refined spec will drive investigation (stack choice), planning, design, implementation, and testing.
