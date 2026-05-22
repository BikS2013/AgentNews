# Investigation: Hosting Byte-Identical HTML Articles with a Catalog

## Executive Summary

The recommended architecture is a **Fastify + TypeScript server that streams article HTML files directly from disk via `@fastify/static`'s `reply.sendFile()`**, backed by a **flat JSON catalog manifest** (`catalog.json`) on disk, with a **server-rendered catalog page** (plain HTML, no client framework). Article HTML files live untouched in an `articles/` directory; the catalog manifest stores `{ slug, title, publishedAt, thumbnailUrl, sourcePath, sha256 }` for each entry. Publishing is done by a **TypeScript CLI tool** (`publish-article`) that parses the source HTML with **cheerio** to extract `<title>` and the first `<img src>`, computes the SHA-256 of the source bytes, and appends to `catalog.json` atomically.

This combination is recommended over the obvious alternatives (Astro `public/`, pure object storage, SQLite, etc.) because it:
1. **Guarantees byte-identity by construction** — `reply.sendFile()` streams the file bytes directly without ever materialising or rewriting them; no build step touches article HTML.
2. **Keeps the publishing workflow programmable in TypeScript** (matches the project's tooling convention) without forcing a static-site rebuild on every new article.
3. **Has near-zero infrastructure complexity** for ~10s–100s of articles — no DB server, no S3 bucket policy, no CI/CD build to debug.
4. **Leaves the door open** to swap the catalog backing (JSON → SQLite) or the hosting (Node server → static bake) without changing the article-serving contract.

A static-site approach (Astro `public/` directory, or 11ty `.eleventyignore` + `addPassthroughCopy`) is a viable runner-up if the user wants to deploy to a pure-static host like Netlify/Cloudflare Pages, but it adds a build step on every publish for no functional gain at this scale.

## Context

- **What was investigated**: Approaches for hosting a small-to-medium library of fully-authored HTML articles with the hard constraint that the served response body must be byte-identical (`sha256(response) == sha256(source-file)`), plus a separate browsable catalog UI.
- **Key requirements** (from the refined request):
  - Byte-identity of every article response — no middleware, CDN, or framework may rewrite article HTML.
  - Catalog showing title (from `<title>`), publication date, thumbnail (first `<img src>`), and a link.
  - Catalog page CAN be rewritten/styled freely (only article pages are sacred).
  - TypeScript-only tooling.
  - Greenfield project — no existing stack to align with.
  - 7 sample articles today, low-double-digits per month growth.
- **Refined request**: `docs/reference/refined-request-html-article-publishing-site.md`.

The investigation must answer five open questions: hosting model, catalog storage, slug/URL strategy, frontend stack for the catalog, and HTML parsing library.

## Options Identified

### Hosting-model options

#### Option A: Lightweight Node server (Fastify or Express) serving raw files

- **Description**: A TypeScript Node server with one route family for the catalog (`/`) that renders from a JSON manifest, and one route family for articles (`/a/<slug>`) that calls `reply.sendFile()` (Fastify) or `res.sendFile()` (Express) to stream the source HTML directly from disk.
- **Strengths**:
  - Both `@fastify/static`'s `reply.sendFile()` and Express's `res.sendFile()` stream the file as-is to the response, with no body transformation by default ([Fastify static](https://github.com/fastify/fastify-static), [Express docs](https://expressjs.com/en/starter/static-files/)).
  - Trivial to verify byte-identity with a SHA-256 test.
  - Catalog updates take effect immediately on disk — no rebuild.
  - Programmable in TypeScript end-to-end (server + CLI tool share types).
  - Easy to disable compression / `Content-Encoding` per-route to guarantee identity-encoding response.
- **Weaknesses**:
  - Requires a running process (a tiny VM, a container, a Render/Fly app, or similar) — not pure-static.
  - Must be careful NOT to register a global `@fastify/compress` or `compression` middleware on article routes (would gzip the body — note: gzip preserves payload bytes at the HTTP body level, but if a test reads the raw socket bytes after decompression it stays identical; still, simplest to disable).
  - HTTP Range requests (206 partial) would NOT match the full-file SHA-256; tests must request the full file (default GET behaviour).
- **Effort/Complexity**: Low
- **Risk**: Low
- **Best suited when**: The team is comfortable running a small Node process and wants a programmable publishing workflow without a rebuild step.

#### Option B: Static site generator with passthrough copy (Astro `public/` or 11ty)

- **Description**: Put the raw HTML files in a directory the SSG copies verbatim to the output. Astro's `public/` directory copies files unchanged ([Astro config docs](https://docs.astro.build/en/reference/configuration-reference/)). Eleventy needs the `.eleventyignore` + `addPassthroughCopy` combo to avoid template-processing the HTML ([11ty discussion #1889](https://github.com/11ty/eleventy/discussions/1889)). The catalog page is a regular SSG page that reads `catalog.json` at build time.
- **Strengths**:
  - Pure-static output — deploy to any static host (Netlify, Cloudflare Pages, GitHub Pages, S3).
  - No running process to maintain.
  - Cheap or free hosting.
- **Weaknesses**:
  - Every publish requires a rebuild and redeploy of the whole site (still seconds at this scale, but a meaningful workflow tax).
  - **CDN risk**: Some hosts (Netlify with "Asset Optimization" enabled, Cloudflare zone-level "Auto Minify") will rewrite HTML if you don't explicitly disable post-processing. This must be locked down per-host and re-verified after every deploy. Asset optimization is opt-in on Netlify but is one toggle away ([Vercel/Netlify/Cloudflare comparison](https://blog.vibecoder.me/vercel-vs-netlify-vs-cloudflare-pages)).
  - Eleventy gotcha: under `.eleventyignore`, the dev server doesn't watch the ignored directory for changes ([11ty discussion #1889](https://github.com/11ty/eleventy/discussions/1889)).
  - Astro `public/` doesn't go through the compiler at all, so it IS truly byte-identical, but Astro pages (i.e. the catalog page) still receive scoped class injection — that's fine, since the catalog page is allowed to be rewritten.
- **Effort/Complexity**: Medium (build pipeline + host-specific verification)
- **Risk**: Medium (CDN/host post-processing must be explicitly disabled and audited)
- **Best suited when**: The team has a strong preference for zero-server hosting and accepts a rebuild on every publish.

#### Option C: Object storage + CDN (S3, Cloudflare R2, or GCS)

- **Description**: Upload each article HTML directly to an object store. The catalog is either a separate static page hosted in the same bucket, or a small JSON file served from the bucket. URLs map directly to object keys.
- **Strengths**:
  - Object stores serve bytes as-uploaded — true byte-identity by definition.
  - R2 has zero egress; S3 is the boring/predictable choice.
  - Infinite read scalability for nearly free at this volume.
- **Weaknesses**:
  - URL aesthetics: getting `index.html`-on-prefix routing working on R2 needs Cloudflare Transform Rules ([R2 hosting discussion](https://community.cloudflare.com/t/hosting-static-websites-on-r2/633020)); S3 needs a static-website bucket configured separately.
  - The catalog page becomes a second deployable surface — you still need to render it from somewhere.
  - Cloudflare's optional zone-level features (Auto Minify, Rocket Loader) can rewrite HTML responses unless explicitly disabled — must be audited.
  - Publishing requires AWS/Cloudflare credentials and an S3-compatible upload step in the CLI tool — more moving parts than writing to a local folder.
- **Effort/Complexity**: Medium
- **Risk**: Medium (credentials, CDN post-processing audit, cross-origin concerns for the catalog page)
- **Best suited when**: The site is expected to scale beyond a single VM, or the team is already invested in AWS/Cloudflare and wants a serverless story.

#### Option D: Headless CMS (Contentful, Sanity, Strapi, etc.)

- **Description**: Store articles in a CMS and serve them via the CMS's content delivery API or a custom frontend.
- **Strengths**: Editorial UI out of the box.
- **Weaknesses**: CMSs assume structured content (title, body, etc.) — they will NOT preserve the full `<!DOCTYPE html>` document including `<style>` blocks byte-for-byte. Most CDA responses are JSON; even those that serve HTML reflow it. This option is **disqualified** by the byte-identity constraint.
- **Effort/Complexity**: High
- **Risk**: High (disqualified)
- **Best suited when**: Never, for this requirement.

### Catalog-storage options

#### Option E: Flat JSON manifest (`catalog.json`)

- **Description**: A single JSON file in the repo (or alongside the articles) holding an array of catalog entries. Read on every request (server) or at build time (SSG).
- **Strengths**: Trivial. Version-controllable. Diff-able. No DB. TypeScript can validate it with Zod. Atomic updates via write-temp-then-rename.
- **Weaknesses**: Re-read cost on every request (negligible at this scale — file is < 50 KB for 100 entries). No queryability beyond what JS can do in-memory.
- **Effort/Complexity**: Low
- **Risk**: Low
- **Best suited when**: Catalog has < 1000 entries; reads dominate; no complex queries.

#### Option F: SQLite file

- **Description**: A single-file SQLite DB containing an `Article` table.
- **Strengths**: Transactional updates; queryable; scales to 100K+ rows with no perf hit; can use `better-sqlite3` synchronously in Node.
- **Weaknesses**: Schema migration overhead; not human-readable; not Git-friendly. Overkill at this scale.
- **Effort/Complexity**: Low–Medium
- **Risk**: Low
- **Best suited when**: The catalog grows beyond hundreds and gains filtering/search needs.

#### Option G: Hosted DB (Postgres, etc.)

- **Description**: A managed Postgres instance with an `Article` table.
- **Strengths**: Operationally familiar; remote-accessible.
- **Weaknesses**: Massive overkill for a read-heavy ~100-entry catalog; introduces a new failure mode and a credentials story.
- **Effort/Complexity**: Medium
- **Risk**: Medium
- **Best suited when**: Multi-author with concurrent writes; out of scope for v1.

### Slug / URL options

#### Option H: Kebab-cased slug derived from `<title>`

- **Description**: `slugify(title, { lower: true, strict: true })` — e.g. `deep-dive-handoff-is-my-new-favourite-skill-matt-pocock`.
- **Strengths**: Human-readable URLs, SEO-friendly.
- **Weaknesses**: Title changes (which we ban in v1 — articles are immutable) would break URLs; collisions need a suffix scheme.
- **Effort/Complexity**: Low
- **Risk**: Low

#### Option I: Filename-derived slug

- **Description**: Use the source filename (minus `.html`) sluggified.
- **Strengths**: Authoritative source is filesystem; predictable.
- **Weaknesses**: Sample filenames have spaces, em-dashes, parentheses — must be normalised. Two articles with similar filenames could collide.
- **Effort/Complexity**: Low
- **Risk**: Low

#### Option J: Short hash / ULID

- **Description**: `/a/01H8X...` — generated at publish time.
- **Strengths**: Always unique; URLs immutable.
- **Weaknesses**: Ugly, unmemorable, not SEO-friendly.
- **Effort/Complexity**: Low
- **Risk**: Low

### Catalog frontend stack

#### Option K: Plain HTML rendered server-side (or at build time) with a tiny template

- **Description**: The catalog page is one HTML document with inline CSS and zero (or minimal) JS, rendered from `catalog.json` either by the Fastify server (Option A) or at SSG build time (Option B). No React/Vue/Svelte needed for a list of cards.
- **Strengths**: Fast, light, no client-bundle, no framework-version-treadmill.
- **Weaknesses**: No client-side filtering without a sprinkle of vanilla JS (acceptable at this scale).
- **Effort/Complexity**: Low

#### Option L: SSG framework (Astro / 11ty / Hugo) for the catalog only

- **Description**: Use Astro or 11ty to build the catalog page; article HTML lives in `public/` (Astro) or behind `.eleventyignore` + passthrough copy (11ty).
- **Strengths**: Nicer DX for the catalog page; component model.
- **Weaknesses**: Rebuild step on every publish; framework footprint for a single page.
- **Effort/Complexity**: Medium

#### Option M: Next.js / SvelteKit (full app framework)

- **Description**: A full app framework with SSR/SSG for the catalog.
- **Weaknesses**: Vast overkill. Next.js especially has many HTML-rewriting behaviours (next/script, next/head) that increase the risk of accidentally violating byte-identity if articles are ever served through a Next route. Best avoided for this requirement.
- **Effort/Complexity**: High
- **Risk**: Medium–High

### HTML-parsing library

#### Option N: cheerio

- **Description**: jQuery-like API on top of parse5/htmlparser2 ([cheerio](https://github.com/cheeriojs/cheerio)).
- **Strengths**: Clean one-liners — `$('title').text()` and `$('img').first().attr('src')`. Handles malformed HTML gracefully. Most widely used in the Node ecosystem.
- **Weaknesses**: Slightly heavier than parse5 directly. For one-shot extraction this is irrelevant.
- **Effort/Complexity**: Low

#### Option O: linkedom

- **Description**: Lightweight DOM implementation with standard `document.querySelector` APIs.
- **Strengths**: Standards-compliant DOM; fast; small.
- **Weaknesses**: Less battle-tested for arbitrary HTML; the title extraction would be `document.querySelector('title').textContent`.
- **Effort/Complexity**: Low

#### Option P: parse5 directly

- **Description**: Spec-compliant HTML5 parser; walk the AST manually.
- **Strengths**: Fastest; most accurate per spec.
- **Weaknesses**: No selector engine — manual tree walk for `<title>` and first `<img>`.
- **Effort/Complexity**: Medium

#### Option Q: Regex with tolerance

- **Description**: `/<title>(.*?)<\/title>/i` and `/<img[^>]+src=["']([^"']+)["']/i`.
- **Strengths**: Zero dependencies.
- **Weaknesses**: Brittle on edge cases (escaped quotes, multi-line tags, commented-out elements). Not recommended for a system that must reliably ingest arbitrary author-written HTML.
- **Effort/Complexity**: Low
- **Risk**: Medium (fragility)

## Comparison Matrix

### Hosting models

| Criterion | A: Fastify | B: SSG passthrough | C: Object storage | D: Headless CMS |
|---|---|---|---|---|
| Byte-identity guarantee | Strong (sendFile stream) | Strong (if host post-processing disabled) | Strong (object store native) | **Disqualified** |
| Publish workflow simplicity | Single CLI command, instant | CLI + rebuild + redeploy | CLI + upload to bucket | CMS UI |
| Infra complexity | Single Node process | Build pipeline + host config | Bucket + CDN config | Vendor lock-in |
| Cost at this scale | ~$5/mo (Fly/Render) | Free (Cloudflare Pages/Netlify) | Pennies/mo (R2) | $0–$$ |
| TS-end-to-end fit | Yes | Partial (build is JS, catalog is TS) | Partial | No |
| Risk of accidental rewrite | Low (one config switch) | Medium (host post-processing) | Medium (CDN rules) | High |

### Catalog storage

| Criterion | E: JSON | F: SQLite | G: Postgres |
|---|---|---|---|
| Fit for ~100 entries | Excellent | Overkill | Vast overkill |
| Atomic updates | Write-temp-then-rename | Native transactions | Native |
| Diff-ability / Git | Yes | No | No |
| Query power | JS in-memory | SQL | SQL |
| Ops overhead | None | None | Significant |

### HTML parser

| Criterion | N: cheerio | O: linkedom | P: parse5 | Q: regex |
|---|---|---|---|---|
| Reliability on real HTML | High | Medium-High | High | Medium |
| API ergonomics | Excellent | Good | Poor | Excellent |
| Bundle size / dep weight | Medium | Small | Small | None |
| Battle-tested in Node | Yes | Yes | Yes | n/a |

## Recommendation

**Hosting**: Option A — **Fastify + TypeScript server, `@fastify/static` with `reply.sendFile()`**.
- Picked over Option B because the project is greenfield and the team values a programmable, no-rebuild publish workflow. Adding a new article should be writing a file + appending a JSON entry, not triggering a deploy.
- Picked over Option C because pure object storage forces the catalog page to live somewhere else anyway, and zero-egress savings are immaterial at this scale.
- Fastify over Express because: built-in TypeScript types, better default schema validation (useful for the catalog manifest), no legacy middleware footguns, modern async-first API.

**Catalog storage**: Option E — **flat `catalog.json` file**.
- Picked over SQLite because the corpus is ~100 entries max and the file is human-readable, Git-diff-able, and trivially backed up. SQLite buys us nothing here.

**Slug strategy**: Option H — **kebab-cased slug from `<title>`, with a sequential suffix on collision** (`-2`, `-3`).
- The slug is computed once at publish time and frozen in `catalog.json`. Re-publishing the same source path is idempotent (Acceptance Criterion 10) by checking SHA-256 against the stored value: identical content → no-op; different content → reject in v1 (Open Question 4 — recommendation: reject and require explicit `--update` flag).
- Backdating (Open Question 6): accept optional `--published-at <ISO>` CLI flag. Default is `new Date().toISOString()`.

**Catalog frontend**: Option K — **plain HTML rendered server-side by Fastify** using a minimal template (no JSX, no React; either string templates or a tiny library like `@fastify/view` with EJS or `eta`). Inline CSS in the catalog page. No client JS in v1 (filtering is out of scope per the refined spec).

**HTML parser**: Option N — **cheerio**.
- Picked for ergonomics: `$('title').text()` and `$('img').first().attr('src')` are unambiguous and resilient. The publishing workflow runs once per article; raw parse speed is irrelevant.

**Conditions under which the recommendation would change**:
- If the user demands zero-server hosting (free static tier), switch to Option B (Astro `public/`) — Astro is preferred over 11ty because its `public/` directory copy is unconditionally byte-faithful without needing an `.eleventyignore` workaround, and the catalog DX is better.
- If the catalog grows past several thousand entries OR multiple editors start publishing concurrently, switch catalog storage from Option E (JSON) to Option F (SQLite via `better-sqlite3`).
- If global edge latency becomes a concern (currently not in scope), front the Fastify server with Cloudflare (proxied, with Auto Minify and Rocket Loader explicitly OFF).

**Caveats and prerequisites**:
- The Fastify server MUST NOT register `@fastify/compress` globally; if compression is desired, exclude article routes explicitly or use `reply.header('Content-Encoding', 'identity')` on article responses.
- The article route MUST set `Content-Type: text/html; charset=utf-8` (matches Acceptance Criterion 11).
- HTTP Range requests must be considered in the byte-identity test — the verification script should issue a plain `GET` (no Range header) and compare the full body.
- The Fastify `setHeaders` option on `@fastify/static` should explicitly set the headers we want; `cacheControl: false` is recommended so we control caching behaviour ourselves.
- The TypeScript publish CLI is a tool per the project's tool-creation conventions and must be scaffolded via `/tool-conventions scaffold publish-article`, not by hand.

## Technical Research Guidance

**Research needed**: Yes — two focused topics.

### Topic 1: `@fastify/static` byte-identical configuration

- **Why**: This is the load-bearing component for the hard byte-identity constraint. We need to know the exact configuration that disables every body-mutating behaviour and verifies what headers are added/can-be-suppressed.
- **Focus**:
  - `decorateReply`, `cacheControl`, `setHeaders`, `serve`, `wildcard` options and their interactions.
  - Whether `@fastify/send` (the underlying engine) applies any conditional GET / `ETag` logic that could short-circuit the response with a 304 (which would return an empty body — the verification script must handle this).
  - How `Content-Type` is determined and how to force `text/html; charset=utf-8` explicitly.
  - Range request behaviour and how to disable it for article routes (or just verify the test issues no Range header).
  - Best pattern for serving from an arbitrary on-disk path (`reply.sendFile(filename, root)`) rather than a single mounted prefix, since article files may live outside the project root.
- **Depth**: Intermediate (deep enough to write the route handler and the test, not a full architecture survey).
- **Relevance**: This is the single point where the byte-identity guarantee lives; getting it wrong invalidates the whole project.

### Topic 2: cheerio extraction patterns for `<title>` and first `<img src>` on self-contained articles

- **Why**: Reliable extraction across all 7 sample articles (and future ones) is required for the catalog to display correctly. Edge cases (multi-line `<title>`, HTML entities in title text, the first `<img>` being inside a deeply nested element) need a known-good pattern.
- **Focus**:
  - Decoding HTML entities in extracted text (e.g. `&mdash;`, `&amp;`) — cheerio's `.text()` decoding behaviour.
  - Document-order traversal to guarantee the FIRST `<img>` is selected (not just any).
  - Whether to use `htmlparser2` mode or default `parse5` mode in cheerio for these self-contained `<!DOCTYPE html>` documents.
  - Validation: what to do when `<title>` is empty or no `<img>` exists (per project convention, raise an explicit error — no fallback).
- **Depth**: Overview.
- **Relevance**: Drives the implementation of the `publish-article` CLI tool's extraction step.

Topics intentionally NOT flagged for deeper research:
- Plain HTML/CSS rendering of the catalog page — well-understood, no research needed.
- JSON file I/O with atomic write — standard Node pattern (`fs.writeFile` to temp + `fs.rename`), no research needed.
- Slug generation — pick `slugify` or `@sindresorhus/slugify`, both well-known.

## Implementation Considerations

- **Verification test (Acceptance Criterion 3)**: A TypeScript test script under `test_scripts/` that:
  1. Reads each source HTML file, computes SHA-256.
  2. Issues `GET /a/<slug>` against the running server, reads the response body as a buffer (NOT decoded as text — buffer comparison is what matters).
  3. Computes SHA-256 of the response body and asserts equality.
  4. Also asserts `Content-Type` header starts with `text/html` and the charset is `utf-8`.
  5. Asserts `Content-Encoding` is absent or `identity` (no gzip/br).
- **Atomic catalog update**: When publishing, write `catalog.json.tmp` then `fs.rename()` it over `catalog.json` to avoid torn reads. Lock-free is acceptable for a single-author workflow.
- **Article storage layout**: Recommend `articles/<slug>.html` to keep the slug ↔ file mapping obvious. Filenames in `samples/` will be renamed by the publish CLI to their slug form.
- **Idempotency check**: At publish time, look up the source path or content SHA-256 in `catalog.json`. If found and SHA-256 matches → no-op (exit 0). If found and SHA-256 differs → exit non-zero with an explanatory error (default policy: reject; future `--update` flag can override).
- **Date format**: Store `publishedAt` as ISO-8601 UTC (`new Date().toISOString()`); render as `YYYY-MM-DD` (or `toLocaleDateString` with explicit locale) in the catalog page.
- **First steps**:
  1. Scaffold the `publish-article` CLI tool via `/tool-conventions scaffold publish-article`.
  2. Set up Fastify with `@fastify/static`, a route for `/` (catalog) and `/a/:slug` (article).
  3. Define a Zod schema for `catalog.json` entries; validate on every load.
  4. Build the verification test script first (TDD) — it will guard the byte-identity invariant from day one.
- **Dependency vetting** (per project `CLAUDE.md`): fastify, `@fastify/static`, cheerio, zod, slugify all need to be vetted against current advisories at the latest stable major versions before pinning. Cheerio in particular has had transitive parse5 churn — verify before pinning.
- **Open Question 4 (re-publish policy)**: Recommend "reject by default, require `--update` to overwrite in place keeping original publication date". Document in the plan.
- **Open Question 7 (deletion)**: Out of scope per refined spec; add as a planned future tool (`unpublish-article`).

## References

| # | Source | URL | What was learned |
|---|--------|-----|-----------------|
| 1 | fastify-static GitHub | https://github.com/fastify/fastify-static | `reply.sendFile()` streams files unmodified; `cacheControl`, `setHeaders`, `decorateReply` options. |
| 2 | @fastify/send on npm | https://www.npmjs.com/package/@fastify/send | Underlying engine returns `{ statusCode, headers, stream }`; stream is piped directly — no body transform. |
| 3 | Express static files docs | https://expressjs.com/en/starter/static-files/ | `express.static` and `res.sendFile()` serve raw bytes; no transformation by default. |
| 4 | Astro configuration reference | https://docs.astro.build/en/reference/configuration-reference/ | `compressHTML` opt-out; `public/` directory copies files verbatim, no compiler involvement. |
| 5 | Astro HTML minification roadmap discussion | https://github.com/withastro/roadmap/discussions/165 | Astro doesn't minify HTML by default; only whitespace compression is opt-in. |
| 6 | 11ty passthrough copy docs | https://www.11ty.dev/docs/copy/ | Default behaviour processes HTML as templates; passthrough copy alone is not enough for HTML. |
| 7 | 11ty discussion #1889 | https://github.com/11ty/eleventy/discussions/1889 | Combo of `.eleventyignore` + `addPassthroughCopy` needed to truly leave HTML untouched. |
| 8 | Cloudflare Pages vs Netlify vs Vercel 2026 | https://blog.vibecoder.me/vercel-vs-netlify-vs-cloudflare-pages | Netlify's Asset Optimization is opt-in; Cloudflare zone-level Auto Minify can rewrite HTML if enabled. |
| 9 | Cloudflare R2 static hosting | https://community.cloudflare.com/t/hosting-static-websites-on-r2/633020 | R2 serves objects byte-identical; URL-routing for `index.html` requires Transform Rules. |
| 10 | cheerio repository | https://github.com/cheeriojs/cheerio | jQuery-like API; wraps parse5/htmlparser2; suitable for `$('title').text()` / `$('img').first().attr('src')`. |
| 11 | HTML parsing library comparison | https://npm-compare.com/cheerio,jsdom,node-html-parser,parse5 | Cheerio vs parse5 vs jsdom trade-offs; cheerio chosen for ergonomics. |

## Original Request

See `docs/reference/refined-request-html-article-publishing-site.md` — the refined-request file is the authoritative specification. Key constraint reproduced here for context:

> Each article must be served byte-for-byte identical to its source HTML file. SHA-256 of the served response body MUST equal SHA-256 of the source file. No middleware, no CDN, no framework may rewrite article HTML. The catalog UI is separate and may be rendered/styled freely.
