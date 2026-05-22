# Project Functions — HTML Article Publishing Site

> Authoritative list of functional requirements for the HTML Article Publishing Site project.
> Derived from `docs/reference/refined-request-html-article-publishing-site.md`.

## Provenance

- **Refined request**: `docs/reference/refined-request-html-article-publishing-site.md`
- **Investigation**: `docs/reference/investigation-html-article-publishing.md`
- **Research — Fastify**: `docs/research/fastify-static-byte-identical.md`
- **Research — cheerio**: `docs/research/cheerio-extraction.md`
- **Plan**: `docs/design/plan-001-html-article-publishing-site.md`

---

## Functional Requirements (v1.0)

### FR1 — Article ingestion via CLI
The system MUST accept a self-contained HTML file as input through a CLI tool (`publish-article`) and add it to the catalog without modifying the file's content. The CLI MUST be scaffolded via `/tool-conventions scaffold publish-article` per project tool-creation rules.

### FR2 — Title extraction
On ingestion, the system MUST extract the article title from the `<title>` element of the source HTML (using cheerio's `$('title').first().text().trim()`) and store it in the catalog metadata. If `<title>` is missing or whitespace-only, the CLI MUST throw `ArticleMetadataError('EMPTY_TITLE')` and refuse to publish.

### FR3 — Thumbnail extraction
On ingestion, the system MUST extract the first `<img src="…">` URL from the article body (using `$('img').first().attr('src')`) and store it as-is (no rewriting, no proxying) as the catalog thumbnail. If no `<img>` exists and the operator did not pass `--thumbnail-url`, the CLI MUST throw `ArticleMetadataError('NO_IMG')`/`NO_THUMBNAIL` and refuse to publish.

### FR4 — Thumbnail override via CLI flag
The publish CLI MUST accept an optional `--thumbnail-url=<URL>` flag. When the source HTML has no `<img>`, the flag value MUST be used as the catalog thumbnail. The source HTML file MUST NEVER be modified, even when the flag is provided.

### FR5 — Publication date capture
On ingestion, the system MUST record the publication date/time as ISO-8601 UTC. The default is `new Date().toISOString()`. An optional `--published-at=<iso>` flag allows backdating for migrations.

### FR6 — Slug generation and stability
The system MUST derive a kebab-case slug from the extracted title (`@sindresorhus/slugify`). On collision with an existing slug, append `-2`, `-3`, … until unique. The slug is **frozen** at publish time and stored in the catalog; it MUST NOT change on subsequent operations.

### FR7 — Byte-identical article copy
The publish CLI MUST copy the source HTML bytes verbatim to `articles/<slug>.html`. The CLI MUST compute SHA-256 of the source buffer and store it in the catalog entry. `sha256(source) === sha256(articles/<slug>.html)` MUST hold.

### FR8 — Catalog persistence
The catalog MUST be persisted as a flat JSON file at `data/catalog.json`. Each entry MUST contain: `{ slug, title, publishedAt, sourcePath, thumbnailUrl, sha256 }` and pass Zod schema validation. Writes MUST be atomic (write-temp-then-rename) to prevent torn reads.

### FR9 — Catalog page (`GET /`)
The site MUST expose a catalog/index page at `GET /` that lists every published article with: thumbnail image, title, publication date (rendered as `YYYY-MM-DD`), and a link to the article. Rendering is plain server-side HTML with inline CSS (no client JS in v1).

### FR10 — Catalog ordering (newest-first)
Catalog entries MUST be ordered by `publishedAt` descending. Ordering is enforced at catalog-save time (Phase 2 sort) and at render time.

### FR11 — Byte-identical article serving (`GET /a/:slug`)
The site MUST serve each article at `GET /a/<slug>` byte-for-byte identical to its source file:
- `sha256(response body) === sha256(articles/<slug>.html)` for plain GET (no Range, no conditional headers).
- `Content-Type` MUST be `text/html; charset=utf-8`.
- `Content-Encoding` MUST be absent or `identity` (no gzip/br).
- Implemented via `@fastify/static@^9.1.3` with `serve: false`, `preCompressed: false`, `cacheControl: false`, `contentType: false`, plus explicit `setHeaders` and a `reply.sendFile()` route handler.
- `@fastify/compress` MUST NOT be registered in the article scope.

### FR12 — Stable article URLs across restart
Each article URL `/a/<slug>` MUST remain stable across server restarts and republications. The slug is frozen at first publish.

### FR13 — Restart persistence
Restarting the server MUST NOT lose catalog entries. The catalog is read from `data/catalog.json` at startup.

### FR14 — Idempotent re-publishing
Running the publish CLI on an already-published source path:
- If `sha256(source)` matches the catalog entry → no-op exit 0 (idempotent).
- If `sha256(source)` differs AND no `--update` flag → exit non-zero (`REPUBLISH_REFUSED`).
- If `sha256(source)` differs AND `--update` is passed → preserve the original `publishedAt`, replace the file under `articles/`, update `sha256` atomically.

### FR15 — Configuration via required environment variables (no fallbacks)
All runtime configuration MUST be supplied via environment variables. Missing variables MUST cause the server (or CLI) to throw on startup. NO fallback values are permitted. Required variables:
- `PORT` — HTTP port the Fastify server listens on.
- `ARTICLES_DIR` — Absolute path to the directory containing `articles/<slug>.html`.
- `CATALOG_PATH` — Absolute path to `catalog.json`.

### FR16 — Byte-identity verification test (operational requirement)
A test script `test_scripts/verify-byte-identity.ts` MUST exist. It MUST:
- Issue plain `node:http` GETs with `Accept-Encoding: identity` and no conditional headers.
- Assert `statusCode === 200` (treat 304 and 206 as failures).
- Assert `Content-Type` contains `text/html` AND `utf-8`.
- Assert `Content-Encoding` is absent or `identity`.
- Compute SHA-256 of the response body and assert equality with both the catalog-stored `sha256` and a fresh disk read.
- Exit non-zero on any mismatch.

---

## Non-Functional Requirements (carried from the refined spec)

- **NFR-Fidelity (NFR11)**: Zero modification of article HTML. No HTTP-level transforms.
- **NFR-Maintainability (NFR12)**: Single-command publishing.
- **NFR-Portability (NFR13)**: Deployable to any Node.js LTS host (VM or container).
- **NFR-Performance (NFR14)**: Catalog page loads under 2 s for the first 50 articles.
- **NFR-Reliability (NFR15)**: Adding a new article requires no downtime; existing URLs remain valid.

---

## Out of Scope (v1)

- Editing/transforming/minifying article HTML.
- Injection of analytics, ads, navigation chrome, or any other content into article HTML.
- Authentication or user accounts.
- Comments, reactions, social features.
- Full-text search.
- Rich CMS UI.
- Migration to other content formats (Markdown, MDX, JSON).
- Multi-tenant / multi-author features.
- Internationalisation/localisation of the catalog UI.
- Pagination (not required at this corpus size).
- Article deletion / unpublishing.
