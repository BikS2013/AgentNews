# Project Design — HTML Article Publishing Site

> **Status**: As-designed (Phase 5 / pre-implementation) + extensions
> **Last updated**: 2026-05-22
> **Supersedes**: nothing (initial design)

## Change log

- **2026-05-22 — Three-list home page**: The homepage was reorganised from two
  sections (videos + external links) into three independent lists, in this
  order: **AI-News** (mixed videos + articles, non-technical), **Deep Dives**
  (technical AI videos), **Articles** (curated external AI articles). The
  `CatalogEntry` schema gained an optional `category: 'deep-dive' | 'ai-news'`
  field (default `'deep-dive'` when absent). The `LinkEntry` schema gained an
  optional `category: 'article' | 'ai-news'` field (default `'article'` when
  absent). Both `publish-article` and `publish-link` CLIs accept a new
  `--category` flag with validated values. The "lead story" feature card was
  removed in favour of three uniform card grids; the hero block is now a
  generic site intro. Agent-facing publishing contract is
  `docs/PUBLISHING.md` (authoritative for autonomous publishing agents — date
  priority, title format, image reference, list mapping).

## Provenance

| Artifact | Path |
|---|---|
| Refined Request | `/Users/giorgosmarinos/aiwork/coding-platform/agent-news/docs/reference/refined-request-html-article-publishing-site.md` |
| Investigation | `/Users/giorgosmarinos/aiwork/coding-platform/agent-news/docs/reference/investigation-html-article-publishing.md` |
| Research — Fastify static | `/Users/giorgosmarinos/aiwork/coding-platform/agent-news/docs/research/fastify-static-byte-identical.md` |
| Research — cheerio extraction | `/Users/giorgosmarinos/aiwork/coding-platform/agent-news/docs/research/cheerio-extraction.md` |
| Plan | `/Users/giorgosmarinos/aiwork/coding-platform/agent-news/docs/design/plan-001-html-article-publishing-site.md` |
| Codebase Scan | NONE — greenfield project |

The implementer MUST read all upstream documents. This design is the contract that the parallel coding agents in Phase 6 of the workflow consume.

---

## 1. Architecture Overview

The system is a **three-tier pipeline** in which the article HTML buffer is captured ONCE at the source boundary, written ONCE to disk, and streamed ONCE to the network — without any read-modify-write step between source and serve.

```
        ┌──────────────────────────────────────────────────────────────┐
        │                       Author Workstation                     │
        │  ──────────────────────────────────────────────────────────  │
        │   samples/<original>.html  (read-only source corpus)         │
        └────────────┬─────────────────────────────────────────────────┘
                     │
                     │ 1. fs.readFileSync(sourcePath) → Buffer
                     │    (buffer is the SOLE byte-source for both
                     │     metadata extraction and disk write)
                     ▼
        ┌──────────────────────────────────────────────────────────────┐
        │                CLI TIER — publish-article                    │
        │  ──────────────────────────────────────────────────────────  │
        │   • cheerio.loadBuffer(buffer)  → title, thumbnailUrl?       │
        │       (cheerio touches a parse tree, NOT the buffer)         │
        │   • slug = slugify(title, existingSlugs)                     │
        │   • sha256 = SHA-256(buffer)                                 │
        │   • fs.writeFile(articles/<slug>.html, buffer)               │
        │       (single write of the original buffer — byte-identical) │
        │   • catalog.append({ slug, title, publishedAt, sha256, … })  │
        │       (atomic: tmp + fsync + rename)                         │
        └────────────┬─────────────────────────────────────────────────┘
                     │
                     │ 2. Buffer crosses the CLI→Disk boundary unchanged
                     ▼
        ┌──────────────────────────────────────────────────────────────┐
        │                       DATA TIER (disk)                       │
        │  ──────────────────────────────────────────────────────────  │
        │   data/catalog.json            (read/write — metadata only)  │
        │   articles/<slug>.html         (write-once, read-many,       │
        │                                  byte-identical to source)   │
        └────────────┬─────────────────────────────────────────────────┘
                     │
                     │ 3. fs.createReadStream(articles/<slug>.html)
                     │    (stream straight to the socket — no rewrite)
                     ▼
        ┌──────────────────────────────────────────────────────────────┐
        │                HTTP TIER — Fastify v5                        │
        │  ──────────────────────────────────────────────────────────  │
        │   Article scope (NO @fastify/compress in this scope):        │
        │     GET /a/:slug → catalog lookup → reply.sendFile()         │
        │                    Content-Type: text/html; charset=utf-8    │
        │                    Content-Encoding absent                   │
        │                                                              │
        │   Catalog scope:                                             │
        │     GET / → renderCatalogHtml(entries) → reply.send(html)    │
        └──────────────────────────────────────────────────────────────┘
```

**The byte-identity invariant** lives in exactly three points:
1. The Buffer captured in the CLI is the same Buffer written to `articles/<slug>.html` (no transformation between read and write).
2. `data/catalog.json` records the SHA-256 of that buffer; this hash is the canonical fingerprint.
3. The HTTP tier reads `articles/<slug>.html` via `reply.sendFile()` and pipes a `fs.createReadStream` directly to the response socket. Nothing — not Fastify, not `@fastify/static`, not `@fastify/send`, not any middleware (we register none on this scope) — touches the body.

The catalog page (`GET /`) is the only HTML the server ever generates. It is explicitly NOT byte-identity-protected and may be styled, rewritten, and rebuilt at will.

---

## 2. Module Organization & File Structure

Absolute paths under `/Users/giorgosmarinos/aiwork/coding-platform/agent-news/`.

### Source (`src/`)

| Path | Purpose | Exports |
|---|---|---|
| `src/config.ts` | Env-var loader. Throws on missing values; no fallbacks. | `config: { PORT: number; ARTICLES_DIR: string; CATALOG_PATH: string }` |
| `src/server.ts` | Fastify v5 entry. Builds the app, mounts the two scopes, calls `listen()`. | `buildServer(): Promise<FastifyInstance>`, default execution when run via `tsx`. |
| `src/server/routes/article.ts` | Encapsulated Fastify plugin: registers `@fastify/static` (`serve: false`) and the explicit `GET /a/:slug` handler. | Default-export Fastify plugin `articleRoutes`. |
| `src/server/routes/catalog.ts` | Encapsulated Fastify plugin: `GET /` handler renders the catalog page. | Default-export Fastify plugin `catalogRoutes`. |
| `src/server/render/catalog.ts` | Pure renderer for the catalog HTML page. | `renderCatalogHtml(entries: CatalogEntry[]): string` |
| `src/catalog/types.ts` | `CatalogEntry` interface + Zod schema + `CatalogFile` envelope. | `CatalogEntry`, `CatalogFile`, `CatalogEntrySchema`, `CatalogFileSchema`. |
| `src/catalog/store.ts` | Atomic load/save/append/update of `catalog.json`, in-memory cache with mtime-based hot reload. | `CatalogStore` class (interface contract — see §6). |
| `src/catalog/slug.ts` | Deterministic kebab-case slug with sequential collision suffix. | `slugify(title: string, existingSlugs: Set<string>): string` |
| `src/extractor/extract.ts` | Pure function: parse buffer with cheerio, return title + thumbnailUrl (or null). | `extractArticleMetadata(htmlBuffer: Buffer): { title: string; thumbnailUrl: string \| null }` |
| `src/extractor/errors.ts` | Typed error for extractor failures. | `ArticleMetadataError` (discriminated `code: 'EMPTY_TITLE' \| 'NO_IMG' \| 'IMG_NO_SRC'`). |
| `src/cli/publish-article.ts` | CLI entrypoint for the `publish-article` tool. Parses argv, drives extractor + store, writes file byte-identically, prints JSON record. | Default execution; on import exposes nothing. |

### Test scripts (`test_scripts/`)

| Path | Purpose |
|---|---|
| `test_scripts/verify-byte-identity.ts` | End-to-end SHA-256 verification against a running server (per research §"Verification Snippet"). |
| `test_scripts/test-extractor.ts` | Unit test of `extractArticleMetadata` against all 7 sample files. |

### Repo root

| Path | Purpose |
|---|---|
| `package.json` | Pinned deps, ESM `"type": "module"`, npm scripts (`dev`, `start`, `publish-article`, `verify`, `test:extractor`, `typecheck`). |
| `tsconfig.json` | `strict: true`, `module: NodeNext`, `target: ES2022`, `noUncheckedIndexedAccess: true`. |
| `.gitignore` | `node_modules/`, `dist/`, `.env`, `.DS_Store`, `*.log`. |
| `.env.example` | Documents `PORT`, `ARTICLES_DIR`, `CATALOG_PATH` — required, no defaults. |
| `Issues - Pending Items.md` | Issue/pending log + Dependency-vetting log. |
| `articles/.gitkeep` | Keeps the (initially empty) articles directory tracked. |
| `data/catalog.json` | Initial empty catalog (envelope form — see §3). |

### Scaffold-produced (NOT hand-written)

| Path | Owner |
|---|---|
| `docs/tools/publish-article.md` | `/tool-conventions scaffold publish-article` |
| `~/.tool-agents/publish-article/` | `/tool-conventions scaffold publish-article` |

---

## 3. Data Models / Schema

### `CatalogEntry`

```ts
export interface CatalogEntry {
  /** Frozen at publish time; kebab-case `[a-z0-9]+(-[a-z0-9]+)*`. */
  slug: string;
  /** Decoded plain text from <title>. */
  title: string;
  /** ISO-8601 UTC string. Captured at publish time unless --date provided. */
  publishedAt: string;
  /** Absolute or repo-relative path of the source HTML used at publish time. */
  sourcePath: string;
  /** Repo-relative path of the byte-identical copy: `articles/<slug>.html`. */
  articlePath: string;
  /** URL string stored verbatim (from first <img src> OR --thumbnail-url). */
  thumbnailUrl: string;
  /** SHA-256 hex of the file bytes at `articlePath`. 64 lowercase hex chars. */
  sha256: string;
  /** Provenance of the thumbnail; informational only. */
  thumbnailSource: 'html' | 'cli-override';
}
```

### `CatalogFile` (top-level envelope)

```ts
export interface CatalogFile {
  /** Format-version of the JSON envelope; increment on breaking schema change. */
  schemaVersion: 1;
  /** Sorted newest-first by publishedAt at save time. */
  entries: CatalogEntry[];
  /** ISO-8601 UTC of the last successful save. */
  updatedAt: string;
}
```

Rationale for a top-level object instead of a bare array: it lets us evolve the schema (new optional fields, migration metadata) without breaking the consumer. The Zod schema enforces `schemaVersion === 1`.

### Initial file contents (`data/catalog.json`)

```json
{ "schemaVersion": 1, "entries": [], "updatedAt": "1970-01-01T00:00:00.000Z" }
```

### File-write contract

Every write to `data/catalog.json` MUST use the following sequence:

1. Serialize `CatalogFile` to UTF-8 JSON (pretty-printed, 2-space indent — for human diff-ability).
2. `fs.writeFile(<path>.tmp, body, { encoding: 'utf-8', flag: 'w' })`.
3. Open `<path>.tmp` and `fs.fsync()` it. Close.
4. `fs.rename(<path>.tmp, <path>)` — atomic on POSIX.

The CLI is the SOLE writer; the server is read-only on `catalog.json`. Single-author, single-writer assumption is documented in the refined spec.

The server reloads the in-memory cache when `fs.watch(CATALOG_PATH)` fires a `change` event (debounced 50 ms). A failed reload (Zod rejection, parse error) keeps the previous in-memory cache and logs the error — the server never serves a half-applied catalog.

### Article file layout

`articles/<slug>.html` — one file per published article. The bytes of this file are exactly the bytes that came off disk at the source path during the publish step. The `sha256` field is computed AFTER the write and is the canonical fingerprint used by the verification test.

---

## 4. API Contracts (HTTP Layer)

### `GET /` — Catalog page

- Response status: `200 OK`.
- Response headers:
  - `Content-Type: text/html; charset=utf-8` (explicit).
  - No `Content-Encoding` is set by the server.
- Response body: server-rendered HTML page produced by `renderCatalogHtml(entries)` (see §6 and the example in §11).
- Caching: no `Cache-Control` set by the server in v1; reload-on-refresh is intentional.

### `GET /a/:slug` — Article page

- Route-level slug validation: `slug` MUST match `^[a-z0-9]+(-[a-z0-9]+)*$`. Mismatches → `reply.callNotFound()`.
- Slug lookup: handler reads from `CatalogStore.getBySlug(slug)`. Missing entry → `reply.callNotFound()` (404).
- On success:
  - `reply.header('Content-Type', 'text/html; charset=utf-8')` — explicit, before `sendFile`.
  - `reply.sendFile(\`${slug}.html\`)` — `@fastify/static` is registered with `serve: false`, `contentType: false`, `preCompressed: false`, `cacheControl: false`, `dotfiles: 'deny'`, `index: false`, `list` unset, and the `setHeaders` callback re-asserts `Content-Type` (belt-and-suspenders).
- Response headers (article success):
  - `Content-Type: text/html; charset=utf-8`.
  - `Content-Encoding`: ABSENT (no compress plugin registered in this scope; verification test asserts).
  - `ETag` + `Last-Modified`: emitted by `@fastify/send`. 304 short-circuits ARE expected for clients that send conditional headers; the verification test omits them and asserts 200.
  - `Accept-Ranges: bytes`: emitted. Range requests not used by the verification test or by browsers on initial load.

### 404 page

A missing slug (either invalid format or unknown) renders a plain `text/html; charset=utf-8` "Not found" page. This page is NOT byte-identity-protected — the byte-identity contract is only for catalog-listed articles.

### Static assets

`@fastify/static` is registered with `serve: false`. There is **no** `/static/*` wildcard route. Files under the registered `root` are reachable ONLY via the explicit `GET /a/:slug` handler and only when the slug is present in the catalog (whitelist).

### Health endpoint

NOT exposed in v1 (resolved ambiguity #1 in the plan). A future `/healthz` would be trivial to add to the catalog scope.

---

## 5. CLI Contract — `publish-article`

### Usage

```
publish-article --source <path> [--thumbnail-url <url>] [--update] [--date <ISO>]
```

| Flag | Required | Meaning |
|---|---|---|
| `--source <path>` | Yes | Path to the source HTML file. Absolute or relative to `process.cwd()`. |
| `--thumbnail-url <url>` | No | Override the catalog thumbnail. Required if the source HTML has no `<img>`. |
| `--update` | No | If the slug already exists, overwrite the file + sha256 + thumbnail; preserve original `publishedAt`. Without this flag, an existing slug → exit 3. |
| `--date <ISO>` | No | Backdate `publishedAt` to the given ISO-8601 UTC string. Default: `new Date().toISOString()`. |

### Behavior (strict order)

1. Parse argv. Missing `--source` → exit 1.
2. Resolve the source path. Read the buffer (`fs.readFileSync`). Source-file read error → exit 2.
3. Run `extractArticleMetadata(buffer)`:
   - On `EMPTY_TITLE` or `IMG_NO_SRC` → exit 1 with the extractor's message.
   - On `NO_IMG` (returned as `thumbnailUrl: null`, not thrown — see §6 contract): apply `--thumbnail-url` if provided; else exit 1 with code `NO_THUMBNAIL`.
4. Load `data/catalog.json` via `CatalogStore.loadAll()`. Validate with Zod. Schema violation → exit 2.
5. Detect re-publish by `sourcePath` match:
   - If matching entry exists and `sha256(buffer) === entry.sha256` → idempotent no-op, exit 0 with informational message.
   - If matching entry exists and sha256 differs:
     - Without `--update` → exit 3 with code `REPUBLISH_REFUSED`.
     - With `--update` → use the existing slug; preserve `publishedAt`; replace file and sha256.
6. New publish:
   - Compute `slug = slugify(title, existingSlugs)`.
   - `publishedAt = --date ?? new Date().toISOString()`.
7. Write `articles/<slug>.html`:
   - `fs.writeFile(<path>.tmp, buffer)` then `fs.rename()` (atomic). Single buffer write — byte-identical to source.
8. Compute `sha256 = SHA-256(buffer)` (using `node:crypto`).
9. Build entry: `{ slug, title, publishedAt, sourcePath, articlePath: \`articles/${slug}.html\`, thumbnailUrl, sha256, thumbnailSource: 'html' | 'cli-override' }`.
10. `CatalogStore.append(entry)` (or `updateBySlug` on `--update`) — atomic write of the full envelope.
11. Print a single-line JSON record to stdout, e.g. `{"slug":"...","sha256":"...","url":"/a/..."}`. Exit 0.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Success (or idempotent no-op). |
| 1 | User error — missing args, validation failure, NO_THUMBNAIL, EMPTY_TITLE, IMG_NO_SRC. |
| 2 | IO error — file read failure, catalog parse failure. |
| 3 | Conflict — slug already exists and `--update` not supplied. |

---

## 6. Interface Contracts Between Parallel Units

These are the inter-unit type contracts. Each unit MUST be implemented strictly against these signatures so that units coded in parallel will integrate cleanly.

### Produced by Unit A (consumed by Units C and D)

```ts
// src/catalog/types.ts
export interface CatalogEntry { /* see §3 */ }
export interface CatalogFile  { /* see §3 */ }
export const CatalogEntrySchema: z.ZodType<CatalogEntry>;
export const CatalogFileSchema:  z.ZodType<CatalogFile>;

// src/catalog/store.ts
export interface CatalogStore {
  /** Load the catalog from disk; validate with Zod. Throws on schema violation. */
  loadAll(): Promise<CatalogFile>;
  /** In-memory snapshot of the most recent successful load. */
  snapshot(): CatalogFile;
  /** Append a new entry; sort newest-first; save atomically. Throws on slug collision. */
  append(entry: CatalogEntry): Promise<void>;
  /** Replace the entry with matching slug; preserve publishedAt unless `entry.publishedAt` is provided explicitly. Save atomically. */
  updateBySlug(slug: string, entry: CatalogEntry): Promise<void>;
  /** O(n) lookup against in-memory snapshot. */
  getBySlug(slug: string): CatalogEntry | undefined;
  /** Start watching the catalog file for external changes; debounced reload. */
  startWatch(): void;
  /** Stop the watcher; idempotent. */
  stopWatch(): void;
}
export function createCatalogStore(catalogPath: string): CatalogStore;

// src/catalog/slug.ts
export function slugify(title: string, existingSlugs: Set<string>): string;

// src/config.ts
export const config: {
  PORT: number;
  ARTICLES_DIR: string;
  CATALOG_PATH: string;
};
```

### Produced by Unit B (consumed by Unit C)

```ts
// src/extractor/extract.ts
export interface ExtractedMetadata {
  title: string;              // non-empty, trimmed, entity-decoded
  thumbnailUrl: string | null; // null when no <img> exists
}
export function extractArticleMetadata(htmlBuffer: Buffer): ExtractedMetadata;

// src/extractor/errors.ts
export class ArticleMetadataError extends Error {
  readonly code: 'EMPTY_TITLE' | 'NO_IMG' | 'IMG_NO_SRC';
  constructor(code: ArticleMetadataError['code'], message: string);
}
```

**Important contract refinement vs. the cheerio research file**: the extractor returns `thumbnailUrl: null` when no `<img>` exists (instead of throwing `NO_IMG`). The CLI then chooses between the `--thumbnail-url` override and the user-facing `NO_THUMBNAIL` error. This keeps the extractor a pure information function and lets the CLI own the policy.

`EMPTY_TITLE` and `IMG_NO_SRC` are still thrown by the extractor — those are unconditional failures, not policy decisions.

### Produced by Unit D (consumed inside Unit D)

```ts
// src/server/render/catalog.ts
export function renderCatalogHtml(entries: CatalogEntry[]): string;
```

### Dependency graph between units

```
        Unit A (catalog data + config)        Unit B (extractor)        Unit E (scaffolding)
                  │                                  │                          │
                  └──────────┬───────────────────────┘                          │
                             │                                                  │
                             ▼                                                  │
            Unit C (publish CLI — depends on A + B)                             │
                                                                                │
            Unit D (HTTP server — depends on A only)                            │
```

Units A, B, and E run in parallel (Wave 1). Units C and D run in parallel (Wave 2) only after Wave 1 completes successfully.

---

## 7. Parallel Implementation Units for Phase 6

### Wave 1 — launched in parallel (no inter-dependencies)

#### Unit A — Catalog Data Layer + Config
**Files to create:**
- `src/config.ts`
- `src/catalog/types.ts`
- `src/catalog/store.ts`
- `src/catalog/slug.ts`

**Deliverable:** all exports from §6 "Produced by Unit A".
**Must satisfy:** atomic writes (tmp + fsync + rename), Zod validation on every load, mtime-debounced hot reload via `fs.watch`, slug regex `^[a-z0-9]+(-[a-z0-9]+)*$`, slug collision suffixes `-2`, `-3`, ….
**Verification:** `npx tsc --noEmit` clean; smoke test that writes two entries, reloads, asserts newest-first ordering.

#### Unit B — Article Extractor
**Files to create:**
- `src/extractor/extract.ts`
- `src/extractor/errors.ts`

**Deliverable:** all exports from §6 "Produced by Unit B".
**Must satisfy:** `cheerio.loadBuffer(buffer)` (NOT `cheerio.load(string)`); `$('title').first().text().trim()`; `$('img').first().attr('src')`; returns `thumbnailUrl: null` (does NOT throw) when no `<img>` is present.
**Verification:** `test_scripts/test-extractor.ts` passes for all 7 sample files (6 with thumbnailUrl, 1 — Hermes Agent — with `thumbnailUrl: null`).

#### Unit E — Scaffolding & Tooling
**Files to create:**
- `package.json`
- `tsconfig.json`
- `.gitignore`
- `.env.example`
- `Issues - Pending Items.md`
- `articles/.gitkeep`
- `data/catalog.json` (envelope-form empty: `{"schemaVersion":1,"entries":[],"updatedAt":"1970-01-01T00:00:00.000Z"}`)

**Deliverable:** A buildable, lintable, audit-clean TypeScript skeleton.
**Must satisfy:** dependency-vetting log entries dated 2026-05-22 for every pinned package; `npm audit` reports 0 HIGH+; `npx tsc --noEmit` exits 0 (no source files yet — empty pass).
**Verification:** `npm install && npm audit && npx tsc --noEmit`.

### Wave 2 — launched in parallel after Wave 1 (depends on A + B)

#### Unit C — Publish CLI
**Files to create:**
- `src/cli/publish-article.ts`
- `test_scripts/test-extractor.ts` (validates Unit B's contract; tests the policy boundary between extractor and CLI)

**Deliverable:** A CLI that satisfies the contract in §5.
**Pre-requirement:** Run `/tool-conventions scaffold publish-article` BEFORE writing `src/cli/publish-article.ts`. That command produces `docs/tools/publish-article.md` and `~/.tool-agents/publish-article/`. Do NOT scaffold by hand.
**Depends on:** Unit A (`CatalogStore`, `slugify`, `config`), Unit B (`extractArticleMetadata`, `ArticleMetadataError`).
**Verification:** publish one sample → catalog gets 1 entry, `articles/<slug>.html` is sha256-equal to source. Re-publish same file → exit 0, catalog unchanged. Hermes Agent without `--thumbnail-url` → exit 1, code `NO_THUMBNAIL`.

#### Unit D — HTTP Server + Catalog UI
**Files to create:**
- `src/server.ts`
- `src/server/routes/article.ts`
- `src/server/routes/catalog.ts`
- `src/server/render/catalog.ts`
- `test_scripts/verify-byte-identity.ts`

**Deliverable:** Fastify v5 server with the two encapsulated scopes per §4 and the verification test per the research file.
**Depends on:** Unit A (`CatalogStore`, `config`, `CatalogEntry`).
**Verification:** start server → `curl http://localhost:3000/` returns 200 HTML; `curl http://localhost:3000/a/<slug>` returns 200 HTML with `Content-Type: text/html; charset=utf-8` and no `Content-Encoding`; `npx tsx test_scripts/verify-byte-identity.ts` exits 0.

### Dispatch instruction for the Phase 6 orchestrator

```
Wave 1 (parallel):  dispatch Unit A, Unit B, Unit E simultaneously.
WAIT for all three to complete successfully.
Wave 2 (parallel):  dispatch Unit C and Unit D simultaneously.
WAIT for both to complete.
Proceed to Phase 7 (sample publication run) only when Wave 2 is green.
```

---

## 8. Error Handling Strategy

| Layer | Failure mode | Behavior |
|---|---|---|
| Config (`src/config.ts`) | `PORT`, `ARTICLES_DIR`, or `CATALOG_PATH` unset | `throw new Error('Missing required env var: <NAME>')`. No defaults. Server fails to boot. |
| Config | `PORT` not an integer | `throw new Error('PORT must be an integer; got: <value>')`. |
| Extractor (`extract.ts`) | `<title>` missing or whitespace-only | `throw new ArticleMetadataError('EMPTY_TITLE', …)`. |
| Extractor | First `<img>` has empty/undefined `src` | `throw new ArticleMetadataError('IMG_NO_SRC', …)`. |
| Extractor | No `<img>` anywhere in the document | Return `{ title, thumbnailUrl: null }` (policy decision deferred to CLI). |
| CLI (`publish-article.ts`) | `thumbnailUrl === null` AND no `--thumbnail-url` flag | Exit 1, code `NO_THUMBNAIL`, explicit message naming the source path. |
| CLI | `--update` not supplied and slug already exists with a different sha256 | Exit 3, code `REPUBLISH_REFUSED`. |
| CLI | Same source path, same sha256 (republish unchanged) | Exit 0, no catalog modification. |
| CatalogStore | `catalog.json` fails Zod validation | `throw` and keep the previous in-memory cache (server); abort the publish (CLI). |
| CatalogStore | Atomic save fails midway | `<path>.tmp` may linger but `<path>` is unchanged. Operator removes the `.tmp`. The server never reads `.tmp`. |
| Server / article route | Slug regex mismatch | `reply.callNotFound()` (404 HTML page). |
| Server / article route | Slug not in catalog | `reply.callNotFound()` (404 HTML page). |
| Server / article route | Catalog entry exists but file is missing on disk | `reply.sendFile` rejects with ENOENT → Fastify error handler logs and returns 500. Operator must reconcile (re-publish or remove the catalog entry). |
| Server startup | `data/catalog.json` missing or invalid | `throw` and abort startup. Operator creates a valid empty envelope. |

---

## 9. Technology / Version Choices

| Package | Pinned | One-line justification |
|---|---|---|
| `node` | current LTS | Required for ESM + `node:fs`/`node:crypto` stability. |
| `typescript` | `^5` | Required for `strict` + `NodeNext` module resolution. |
| `tsx` | latest at install time | Dev runner; transitively depends on `esbuild` — log vetted-on date. |
| `fastify` | `^5` | Required by `@fastify/static@^9.x`; modern async-first API. |
| `@fastify/static` | `^9.1.3` | Patches CVE-2026-6410 (path traversal), CVE-2026-6414 (route-guard bypass), and the v9.1.0 `sendFile`-option-override bug. |
| `cheerio` | `^1.2.0` | Stable, parse5-based, no known direct advisories as of 2026-05-22. |
| `@sindresorhus/slugify` | `^2` | Modern ESM-native slugifier; vet on install. |
| `zod` | `^3` | Schema validation for `catalog.json`; vet on install. |
| `@types/node` | `^20` | Matches LTS major. |

NO `@fastify/compress` is installed. NO `express`, `axios`, `http-proxy*`, `jsonwebtoken`, `jose`, or other fast-moving network/crypto/proxy packages are pulled in.

Run `npm audit` post-install. Any HIGH+ advisory blocks Phase 1.

---

## 10. Security & Non-Functional Considerations

### Compression isolation

**`@fastify/compress` is NOT installed in v1, and MUST NOT be added to the article scope when it is added later.** The article-scope route handler MUST remain free of any `onSend` hook that mutates the response body. Specifically, in `src/server.ts` add the following comment above the article scope registration:

```ts
// CRITICAL: do not register @fastify/compress (or any onSend hook that mutates
// the response body) anywhere in this scope. Article responses must be served
// byte-identical to the source file. See docs/research/fastify-static-byte-identical.md.
```

### Request-body parsing

Article and catalog routes are GET-only. There is no JSON body parser registered; `request.body` is `undefined` on these routes.

### Slug regex

The slug regex is `^[a-z0-9]+(-[a-z0-9]+)*$`. Anything else is rejected at the route level with `reply.callNotFound()`. This pre-empts the CVE-2026-6414 attack family (encoded `%2F` path-traversal in `@fastify/static <= 9.1.0`) even though the pinned version 9.1.3 is already patched.

### Articles whitelist

`articles/` is a flat directory of `*.html` files keyed by slug. The route handler only ever calls `reply.sendFile(\`${slug}.html\`)` when `CatalogStore.getBySlug(slug)` returns a hit. Files that exist on disk but have no catalog entry are unreachable.

### CVE awareness — `@fastify/static`

- `list` MUST remain unset (CVE-2026-6410).
- `preCompressed` MUST remain `false` (would otherwise serve `.br`/`.gz` sidecars and break byte-identity).
- Pin is `^9.1.3` (both CVEs patched + v9.1.0 sendFile-option bug fixed).

### Operational notes

- The server is single-process, single-node. Concurrent publishes from multiple terminals are not supported (single-author assumption in the refined spec).
- The catalog write is atomic; partial state is never observable to the server.

---

## 11. Integration Points

There are no integration points with existing code — this is a greenfield project. The plan/scan files explicitly confirm no `CODEBASE_SCAN_FILE` exists.

External integrations:
- **YouTube thumbnail URLs** referenced by `thumbnailUrl` are NOT proxied. If `img.youtube.com` returns 404 for a thumbnail, the catalog will show a broken image. This is documented as acceptable v1 behavior in the refined spec.

---

## 12. Architectural Decision Records (ADRs)

### ADR-001 — Fastify v5 + `@fastify/static@^9.1.3`
- **Decision:** Use Fastify v5 with `@fastify/static@^9.1.3` (`serve: false` + explicit route + `reply.sendFile()`) as the HTTP layer.
- **Rationale:** Fastify v5 is the current major; `@fastify/static@^9.x` is the only line compatible with it. v9.1.3 is the first version that patches both CVE-2026-6410 (path traversal via `list`) and CVE-2026-6414 (route-guard bypass via `%2F`), and includes the v9.1.0 `sendFile`-option-override fix.
- **Source:** investigation §"Hosting-model options", Fastify-static research §"Installation" + §"Updates to Investigation".

### ADR-002 — cheerio for HTML metadata extraction
- **Decision:** Use `cheerio@^1.2.0` for `<title>` and first `<img>` extraction at publish time only.
- **Rationale:** Best ergonomics for two-field extraction (`$('title').first().text()`, `$('img').first().attr('src')`); document-order guarantee; automatic entity decoding; battle-tested. The source HTML is never serialized back through cheerio — only the original Buffer is written to disk — so cheerio cannot affect byte-identity.
- **Source:** cheerio-extraction research §"Quick Comparison".

### ADR-003 — JSON manifest for the catalog (no database)
- **Decision:** Catalog metadata lives in a single `data/catalog.json` file with a versioned envelope (`schemaVersion: 1`).
- **Rationale:** Corpus is ~100 entries max in foreseeable future; JSON is Git-diff-able, human-inspectable, trivially backed up, and supports atomic writes (tmp + rename). SQLite or Postgres is overkill at this scale.
- **Source:** investigation §"Catalog-storage options".

### ADR-004 — Kebab-case slug derived from `<title>`, frozen at publish time
- **Decision:** Compute the slug once at publish time as `slugify(title)`; on collision append a sequential numeric suffix (`-2`, `-3`, …); store the slug verbatim in `catalog.json` and never recompute it.
- **Rationale:** Human-readable, SEO-friendly URLs; freezing the slug satisfies AC5 (stable URLs across restart) and AC10 (idempotent re-publish).
- **Source:** investigation §"Slug / URL options".

### ADR-005 — `--thumbnail-url` CLI override when source HTML has no `<img>`
- **Decision:** The CLI accepts an optional `--thumbnail-url <url>` flag. When the source HTML contains no `<img>` element, the CLI uses the flag value as the catalog thumbnail. If the source has no `<img>` AND no `--thumbnail-url` is given, the CLI exits 1 with code `NO_THUMBNAIL`. The source HTML is NEVER modified.
- **Rationale:** The Hermes Agent sample article uses an `<iframe>` for its video embed and has no `<img>`. The refined-spec amendment (resolved during workflow) chose this override mechanism over modifying the source HTML, preserving the byte-identity invariant.
- **Source:** refined-request amendment (recorded in plan-001 §"Locked Architectural Decisions" row "Missing-image policy"); cheerio-extraction research §"Expected Output" Hermes row.

### ADR-006 — `serve: false` + explicit route + slug whitelist for `@fastify/static`
- **Decision:** Register `@fastify/static` with `serve: false`. Define a single explicit route `GET /a/:slug` that (a) validates the slug against the regex, (b) checks the slug against the catalog, then (c) calls `reply.sendFile()`. No wildcard route is exposed.
- **Rationale:** Full control over slug validation and 404 semantics; eliminates the entire path-traversal CVE class even on patched plugin versions; keeps the article routes encapsulated in a Fastify scope that intentionally contains no body-mutating hooks.
- **Source:** Fastify-static research §"`serve`" + §"Production Pattern: Slug → Filename Mapping".

### ADR-007 — No-fallback configuration
- **Decision:** Every required environment variable (`PORT`, `ARTICLES_DIR`, `CATALOG_PATH`) MUST be present at startup. Missing values throw on boot. There are no defaults.
- **Rationale:** Project-wide convention from `CLAUDE.md` ("You must never create fallback solutions for configuration settings"). Fail-loud beats silent misbehavior.
- **Source:** project `CLAUDE.md` §"Structure & Conventions" — no-fallback rule.

### ADR-008 — Mandatory `/tool-conventions scaffold publish-article` for the CLI tool
- **Decision:** Before writing `src/cli/publish-article.ts`, the implementer MUST invoke `/tool-conventions scaffold publish-article`. That command produces `docs/tools/publish-article.md` and the `~/.tool-agents/publish-article/` configuration folder with the four-tier env-var resolution chain wired up. The CLAUDE.md "Tools" section will be updated to reference `docs/tools/publish-article.md`.
- **Rationale:** Project-wide convention from `CLAUDE.md` ("Tool creation is MANDATORY via `/tool-conventions scaffold <tool-name>`"). Hand-scaffolding breaks downstream agents that parse the doc and config formats.
- **Source:** project `CLAUDE.md` §"Structure & Conventions" — tool-conventions rule.

---

## 13. Implementation units for Phase 6 (dispatch summary)

This section duplicates §7 in a form the workflow orchestrator can consume directly.

```
WAVE 1 (parallel — no dependencies):
  Unit A — Catalog data layer + config
    Files: src/config.ts, src/catalog/types.ts, src/catalog/store.ts, src/catalog/slug.ts
    Contract: §6 "Produced by Unit A"
    Verification: tsc --noEmit; smoke append/reload test

  Unit B — Article extractor
    Files: src/extractor/extract.ts, src/extractor/errors.ts
    Contract: §6 "Produced by Unit B"
    Verification: tsc --noEmit; behavior matches the 7-sample table in cheerio research §5

  Unit E — Scaffolding & tooling
    Files: package.json, tsconfig.json, .gitignore, .env.example,
           Issues - Pending Items.md, articles/.gitkeep, data/catalog.json
    Verification: npm install && npm audit (0 HIGH+) && tsc --noEmit (0 source files)

WAVE 2 (parallel — depends on Wave 1):
  Unit C — Publish CLI
    Pre-requirement: run `/tool-conventions scaffold publish-article` FIRST
    Files: src/cli/publish-article.ts, test_scripts/test-extractor.ts
    Depends on: Unit A + Unit B
    Verification: publish 1 sample → catalog has 1 entry; re-publish same → no-op;
                  Hermes Agent without --thumbnail-url → exit 1 NO_THUMBNAIL

  Unit D — HTTP server + catalog UI
    Files: src/server.ts, src/server/routes/article.ts, src/server/routes/catalog.ts,
           src/server/render/catalog.ts, test_scripts/verify-byte-identity.ts
    Depends on: Unit A
    Verification: GET / returns catalog HTML; GET /a/:slug returns byte-identical
                  article with Content-Type: text/html; charset=utf-8 and no
                  Content-Encoding; verify-byte-identity.ts exits 0
```

After Wave 2 is green, Phase 7 (sample publication run) and Phase 8 (documentation updates) proceed sequentially per the plan.
