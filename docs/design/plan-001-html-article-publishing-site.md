# Plan 001 — HTML Article Publishing Site (v1.0)

> **Plan file**: `docs/design/plan-001-html-article-publishing-site.md`
> **Status**: Ready for execution
> **Created**: 2026-05-22

## Provenance (read FIRST before executing this plan)

| Artifact | Path |
|---|---|
| Refined Request | `/Users/giorgosmarinos/aiwork/coding-platform/content-place2/docs/reference/refined-request-html-article-publishing-site.md` |
| Investigation | `/Users/giorgosmarinos/aiwork/coding-platform/content-place2/docs/reference/investigation-html-article-publishing.md` |
| Technical Research — Fastify static | `/Users/giorgosmarinos/aiwork/coding-platform/content-place2/docs/research/fastify-static-byte-identical.md` |
| Technical Research — cheerio extraction | `/Users/giorgosmarinos/aiwork/coding-platform/content-place2/docs/research/cheerio-extraction.md` |
| Codebase scan | **NONE** — greenfield project, no existing source files |

The implementer MUST read all four upstream documents before executing any phase. The refined-request defines acceptance criteria; the investigation locks the architecture; the two research files lock the implementation details for the byte-identity guarantee and the metadata extraction.

---

## Open Ambiguities (resolve with orchestrator before Phase 7 ship)

1. **`/healthz` endpoint**: Not in refined spec. Defaulting to NOT exposing one in v1; revisit if a deployment target requires it.
2. **Catalog page styling**: Minimal inline CSS, no theming framework. User to confirm visual acceptability after Phase 7 publication run.
3. **Sample filenames retain spaces and em-dashes**: The publish CLI resolves source files by path argument, so `samples/*.html` need NOT be renamed. The output filename under `articles/<slug>.html` is the kebab-cased slug.
4. **npm scripts**: Plan defaults to adding convenience scripts (`dev`, `start`, `publish-article`, `verify`, `typecheck`) to `package.json`. Flag for confirmation; if rejected, all commands fall back to `npx tsx <path>` invocations documented inline.

---

## Objective

Build a Node.js + TypeScript (strict) site that hosts a growing library of self-contained HTML articles and serves each one **byte-for-byte identical to its source file** while exposing a browsable catalog. Ship the seven sample articles in `samples/` as the initial corpus (with the Hermes-Agent article requiring an explicit `--thumbnail-url` override at publish time).

This plan satisfies all 10 acceptance criteria in the refined spec (AC1–AC10) and the non-functional requirements NFR11 (fidelity) through NFR15 (reliability).

---

## Locked Architectural Decisions (do not re-open)

| Area | Decision |
|---|---|
| Runtime | Node.js current LTS |
| Language | TypeScript with `strict: true` |
| HTTP framework | Fastify v5 |
| Static serving | `@fastify/static@^9.1.3` (CVE-patched), `serve: false` + explicit `GET /a/:slug` route + `reply.sendFile()` |
| HTML parsing (publish time only) | `cheerio@^1.2.0` |
| Dev runner | `tsx` (no ts-node) |
| Frontend framework | **None** — catalog page is server-rendered plain HTML with inline CSS |
| Catalog storage | Flat `data/catalog.json` (JSON manifest), atomic write-temp-then-rename, in-memory cache, re-read on file change |
| Slug strategy | Kebab-case from `<title>`, sequential numeric suffix on collision, **frozen at publish time** |
| Publish workflow | TypeScript CLI tool `publish-article`, **MUST** be scaffolded via `/tool-conventions scaffold publish-article` (mandatory project convention) |
| Missing-image policy | CLI accepts optional `--thumbnail-url=<URL>`. If HTML has no `<img>` AND no `--thumbnail-url`, the CLI raises `NO_THUMBNAIL` and refuses to publish. HTML is never modified. |
| Re-publish policy | Refuse by default; require explicit `--update` flag. On `--update`: preserve original `publishedAt`, replace file and `sha256`. |
| Byte-identity verification | `test_scripts/verify-byte-identity.ts`: forces `Accept-Encoding: identity`, uses raw `node:http` (no auto-decompression), asserts 200 + `Content-Type: text/html; charset=utf-8` + Content-Encoding absent or `identity`, computes SHA-256 of response body and compares to catalog-stored hash AND to disk hash. |
| Configuration | **NO fallbacks**. `PORT`, `ARTICLES_DIR`, `CATALOG_PATH` (and any future config) MUST be required env vars; missing → throw on startup. |
| Database | **None** — flat JSON only. |

---

## Repository Layout (target)

```
content-place2/
├── package.json
├── tsconfig.json
├── .gitignore
├── .env.example
├── Issues - Pending Items.md
├── articles/                      # Byte-identical published files (slug.html)
│   └── .gitkeep
├── data/
│   └── catalog.json               # [] at scaffolding time
├── samples/                       # Existing 7 source articles (untouched)
├── src/
│   ├── server.ts                  # Fastify entry, scope isolation
│   ├── server/
│   │   ├── routes/
│   │   │   ├── article.ts         # GET /a/:slug
│   │   │   └── catalog.ts         # GET /
│   │   └── render/
│   │       └── catalogPage.ts     # Plain HTML template
│   ├── catalog/
│   │   ├── types.ts               # Zod schema + types
│   │   └── store.ts               # load/save/in-memory cache
│   ├── extractor/
│   │   └── extractArticleMetadata.ts
│   └── tools/
│       └── publish-article/       # Implementation files; docs/config scaffolded separately
│           ├── index.ts           # CLI entry
│           ├── slug.ts            # Kebab + collision suffix
│           └── sha256.ts          # SHA-256 helper
├── test_scripts/
│   ├── verify-byte-identity.ts    # End-to-end byte-identity assertion
│   └── extractor.test.ts          # Manual unit run for the 7 samples
├── docs/
│   ├── design/
│   │   ├── plan-001-html-article-publishing-site.md (this file)
│   │   ├── project-design.md
│   │   └── project-functions.md
│   ├── reference/                 # Refined request, investigation, scan files
│   ├── research/                  # Fastify and cheerio research
│   └── tools/
│       └── publish-article.md     # **Scaffold-produced — NOT hand-written**
└── ~/.tool-agents/publish-article/  # **Scaffold-produced (outside repo)**
```

**Files NOT to scaffold by hand:**
- `docs/tools/publish-article.md` — produced by `/tool-conventions scaffold publish-article`.
- `~/.tool-agents/publish-article/` and its `.env` — produced by `/tool-conventions scaffold publish-article`.

---

## Phases — Dependency Graph

```
Phase 1: Scaffolding & deps
        │
        ├──► Phase 2: Catalog data layer        ┐
        ├──► Phase 3: Article extractor         │   (Phase 2 || Phase 3 may run in parallel)
        │                                       │
        ├──► Phase 4: Publish CLI ◄─── needs 2+3
        │
        └──► Phase 5: Fastify server ◄─── needs 2+3
                       │
                       ▼
              Phase 6: Byte-identity verification test
                       │
                       ▼
              Phase 7: Sample publication run (7 articles)
                       │
                       ▼
              Phase 8: Documentation updates
```

---

## Phase 1 — Project Scaffolding & Dependencies

### Goal
Create the TypeScript project skeleton with verified, security-audited dependencies pinned to the locked versions.

### Pre-flight (MANDATORY before adding ANY dep)
Per project `CLAUDE.md` `<dependency-vetting>`:
1. Identify the latest stable major version on the registry (`npm view <pkg> versions --json | tail -10`).
2. Check GitHub Advisory DB / `npm audit --package <pkg>@<version> --json` for HIGH+ advisories.
3. Pin to a caret range against the verified-clean version.
4. Log the vetted-on date in `Issues - Pending Items.md` under a "Dependency vetting log" section.
5. Run `npm audit` after install and fail the phase if any HIGH+ advisory appears.

### Tasks
1. **Confirm Node LTS**: `node --version` → must be a current LTS major.
2. **Initialize package**: Create `package.json` with `"type": "module"` (ESM), pinned scripts, and the following pinned dependencies:
   - `fastify@^5`
   - `@fastify/static@^9.1.3` (CVE-2026-6410, CVE-2026-6414 patched; sendFile-option-override bug fixed)
   - `cheerio@^1.2.0`
   - `@sindresorhus/slugify@^2` (vet before pinning; fallback: `slugify@^1`)
   - `zod@^3` (vet before pinning)
   - devDeps: `typescript@^5`, `tsx@latest`, `@types/node@^20`
3. **Create `tsconfig.json`** with: `strict: true`, `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `outDir: dist`, `rootDir: src`, `esModuleInterop: true`, `resolveJsonModule: true`, `forceConsistentCasingInFileNames: true`, `noUncheckedIndexedAccess: true`, `skipLibCheck: true`.
4. **Create `.gitignore`**: `node_modules/`, `dist/`, `.env`, `.DS_Store`, `*.log`.
5. **Create `.env.example`** documenting required env vars (NO defaults, just descriptions):
   ```
   # All variables below are REQUIRED — the server throws on startup if any is missing.
   PORT=                  # HTTP port (integer, e.g. 3000)
   ARTICLES_DIR=          # Absolute path to the articles directory (e.g. ./articles)
   CATALOG_PATH=          # Absolute path to catalog.json (e.g. ./data/catalog.json)
   ```
6. **Create `articles/.gitkeep`** and **`data/catalog.json`** containing `[]`.
7. **Create `Issues - Pending Items.md`** with two sections:
   - Pending Items (empty initially)
   - Dependency vetting log (one row per pinned dep with date 2026-05-22)
8. **Add npm scripts** (subject to ambiguity #4):
   - `"dev": "tsx watch src/server.ts"`
   - `"start": "tsx src/server.ts"`
   - `"typecheck": "tsc --noEmit"`
   - `"publish-article": "tsx src/tools/publish-article/index.ts"`
   - `"verify": "tsx test_scripts/verify-byte-identity.ts"`
   - `"test:extractor": "tsx test_scripts/extractor.test.ts"`

### Verification commands
```bash
node --version                  # confirm LTS
npm install
npm audit                       # MUST report 0 vulnerabilities at HIGH+
npx tsc --noEmit                # passes (no source yet)
```

### Acceptance criteria
- `npm install` exits 0.
- `npm audit` reports 0 HIGH or CRITICAL advisories. Any finding blocks Phase 1.
- `npx tsc --noEmit` exits 0.
- `Issues - Pending Items.md` "Dependency vetting log" has dated entries for every pinned dependency.

---

## Phase 2 — Catalog Data Layer  *(parallelizable with Phase 3)*

### Goal
A typed, validated, atomic in-memory + on-disk catalog store.

### Tasks
1. **`src/catalog/types.ts`** — Zod schema for `CatalogEntry`:
   ```ts
   const CatalogEntry = z.object({
     slug: z.string().regex(/^[a-z0-9-]+$/),
     title: z.string().min(1),
     publishedAt: z.string().datetime(),       // ISO-8601 UTC
     sourcePath: z.string().min(1),
     thumbnailUrl: z.string().url(),
     sha256: z.string().regex(/^[a-f0-9]{64}$/)
   });
   export type CatalogEntry = z.infer<typeof CatalogEntry>;
   export const CatalogSchema = z.array(CatalogEntry);
   ```
2. **`src/catalog/store.ts`** — exports:
   - `loadCatalog(path: string): Promise<CatalogEntry[]>` — reads, parses, validates with Zod, throws on schema violation.
   - `saveCatalog(path: string, entries: CatalogEntry[]): Promise<void>` — writes `<path>.tmp` then `fs.rename()` over `<path>` (atomic).
   - `appendEntry(path, entry)` — load → push → sort by `publishedAt desc` → save atomically.
   - `findBySlug(entries, slug)`, `findBySourcePath(entries, sourcePath)`.
   - In-memory cache with `fs.watch` (or a debounced re-read) for the server's use; tests use direct `loadCatalog`.

### Verification
```bash
npx tsc --noEmit
```
Quick smoke (inline tsx eval or `test_scripts/catalog.smoke.ts` ad-hoc):
- Validate a known-good entry → no throw.
- Validate an entry with missing `sha256` → Zod throws.
- Append two entries, reload from disk → ordering preserved (newest-first).

### Acceptance criteria
- Zod schema rejects malformed entries.
- Atomic save: killing the process mid-write never leaves `data/catalog.json` empty (a `.tmp` may remain, but `catalog.json` is intact).
- Round-trip: `save([e1, e2]); const got = load(); deepEqual(got, sortedNewestFirst([e1, e2]))`.

---

## Phase 3 — Article Extractor  *(parallelizable with Phase 2)*

### Goal
A pure function that returns `{ title, thumbnailUrl }` from an HTML buffer, throwing typed errors on missing/empty fields. Per `docs/research/cheerio-extraction.md`.

### Tasks
1. **`src/extractor/extractArticleMetadata.ts`** — implements the helper exactly as specified in section 4 of `docs/research/cheerio-extraction.md`:
   - `cheerio.loadBuffer(htmlBuffer)` (NOT `cheerio.load(string)`).
   - `$('title').first().text().trim()` → throw `ArticleMetadataError('EMPTY_TITLE', …)` if empty.
   - `$('img').first()`:
     - If `.length === 0` → throw `ArticleMetadataError('NO_IMG', …)`.
     - If `.attr('src')` is `undefined` OR empty string → throw `ArticleMetadataError('IMG_NO_SRC', …)`.
   - Export `ArticleMetadataError` class with `code: 'EMPTY_TITLE' | 'NO_IMG' | 'IMG_NO_SRC'`.
2. **`test_scripts/extractor.test.ts`** — manual unit script:
   - Iterates over all 7 files in `samples/`.
   - Asserts the expected `title` and `thumbnailUrl` per the table in section 5 of `docs/research/cheerio-extraction.md`.
   - For the Hermes-Agent file: asserts `ArticleMetadataError` with `code === 'NO_IMG'`.
   - Exits non-zero on any mismatch.

### Verification
```bash
npx tsc --noEmit
npx tsx test_scripts/extractor.test.ts
```

### Acceptance criteria
- Extractor returns correct title + thumbnailUrl for 6 of 7 samples (Matt Pocock, Scaling Agents, Opus 4.7, Cooking with Agents, Anthropic, Zsh Setup).
- Extractor throws `ArticleMetadataError('NO_IMG')` for the Hermes-Agent file.
- No HTML is ever written/modified (assertion: `samples/` mtime unchanged after running the test).

---

## Phase 4 — Publish CLI (`publish-article` tool)

### Goal
A TypeScript CLI that ingests a source HTML path, extracts metadata, generates a slug, copies the file byte-identically to `articles/<slug>.html`, computes SHA-256, and appends an entry to `catalog.json`.

### MANDATORY scaffolding step (first action of Phase 4)
Run the project's mandatory tool-creation command:
```
/tool-conventions scaffold publish-article
```
This produces:
- `docs/tools/publish-article.md` (the tool's XML-block documentation)
- `~/.tool-agents/publish-article/` (config folder, mode 0700) with `.env` (mode 0600) and the four-tier env-var resolution chain wired up.

**DO NOT hand-write either of those.** The slash command owns the spec.

### Tasks (implementation files under `src/tools/publish-article/`)

1. **`src/tools/publish-article/sha256.ts`** — `sha256(buf: Buffer): string` using `node:crypto`.

2. **`src/tools/publish-article/slug.ts`** — `generateSlug(title, existingSlugs): string`:
   - `@sindresorhus/slugify(title, { lowercase: true, decamelize: false })`.
   - If `existingSlugs.includes(base)`, append `-2`, `-3`, … until unique.

3. **`src/tools/publish-article/index.ts`** — CLI entry:
   - Parses `argv`: positional `<source-path>`, flags `--thumbnail-url=<url>`, `--update`, `--published-at=<iso>`.
   - Loads env config (`ARTICLES_DIR`, `CATALOG_PATH`) — throws if missing.
   - Reads the source HTML into a Buffer ONCE; this buffer is the byte-identical source.
   - Calls `extractArticleMetadata(buffer)`:
     - On `NO_IMG`: if `--thumbnail-url` is provided, override `thumbnailUrl` with the flag value and continue. If not provided → exit 1 with code `NO_THUMBNAIL` and a helpful message.
     - On `EMPTY_TITLE` or `IMG_NO_SRC`: exit 1, no override.
   - Loads `catalog.json`, validates with Zod.
   - **Re-publish detection** (by `sourcePath` match):
     - Same `sha256` → no-op exit 0 (idempotent — AC10).
     - Different `sha256` → if no `--update` flag, exit 1 with `REPUBLISH_REFUSED`. If `--update`: preserve original `publishedAt`, overwrite file + sha256, atomic catalog save.
   - **New publish**:
     - Generate slug (collision suffix against `catalog.json`).
     - `publishedAt = --published-at || new Date().toISOString()`.
     - Copy buffer to `articles/<slug>.html` via `fs.writeFile` (single buffer write — guaranteed byte-identical).
     - Compute SHA-256.
     - Append entry `{ slug, title, publishedAt, sourcePath, thumbnailUrl, sha256 }`, save atomically.
   - Print a single-line success summary including the resulting URL `/a/<slug>` and SHA-256.

### Verification
```bash
npx tsc --noEmit
# Single-file smoke (will be replayed for all 7 in Phase 7):
npm run publish-article -- "samples/Deep Dive — _handoff is my new favourite skill (Matt Pocock).html"
# Re-publish refusal:
npm run publish-article -- "samples/Deep Dive — _handoff is my new favourite skill (Matt Pocock).html"   # expect exit 0 (idempotent)
# Hermes Agent without --thumbnail-url:
npm run publish-article -- "samples/Deep Dive — Hermes Agent Phone Number (David Ondrej).html"           # expect exit 1, code NO_THUMBNAIL
# Hermes Agent with --thumbnail-url:
npm run publish-article -- "samples/Deep Dive — Hermes Agent Phone Number (David Ondrej).html" --thumbnail-url=https://img.youtube.com/vi/zHE434sBw2U/maxresdefault.jpg
```

### Acceptance criteria
- Scaffold artifacts exist (`docs/tools/publish-article.md`, `~/.tool-agents/publish-article/`).
- AC8: a single command publishes from disk, extracts title + thumbnail, records publishedAt, atomically updates catalog.
- AC10: running the same publish twice without `--update` does NOT add a second entry.
- `--thumbnail-url` flag works on the Hermes-Agent file; the HTML file in `samples/` is unchanged (mtime + sha256).
- Source HTML in `samples/` is never modified; `articles/<slug>.html` is byte-identical to source (`sha256(source) === sha256(articles/<slug>.html)`).

---

## Phase 5 — Fastify Server

### Goal
A Fastify v5 server with two routes — catalog (`GET /`) and article (`GET /a/:slug`) — using the byte-identical configuration from `docs/research/fastify-static-byte-identical.md`.

### Tasks

1. **`src/server.ts`** — composition root:
   - Read env: `PORT`, `ARTICLES_DIR`, `CATALOG_PATH`. Each missing → `throw new Error('<NAME> environment variable is required')`. **NO defaults.**
   - Load catalog at startup; `fs.watch(CATALOG_PATH)` triggers reload.
   - Register two scopes (per research file's Pattern 1):
     - **Article scope**: registers `@fastify/static` with the locked options (see below) and the `GET /a/:slug` route. **NO `@fastify/compress` in this scope.**
     - **Catalog scope**: registers the `GET /` handler. Compress MAY be added here later if needed; not in v1.
   - Listen on `PORT`.

2. **`src/server/routes/article.ts`** — exports a Fastify plugin that registers `@fastify/static` with **EXACTLY** these options:
   ```ts
   {
     root: path.resolve(ARTICLES_DIR),
     serve: false,              // explicit route only
     decorateReply: true,
     index: false,
     cacheControl: false,
     etag: true,
     lastModified: true,
     acceptRanges: true,
     preCompressed: false,       // CRITICAL — never true
     contentType: false,         // we set Content-Type manually
     dotfiles: 'deny',
     // `list` MUST remain unset (CVE-2026-6410)
     setHeaders: (res, filePath) => {
       if (filePath.endsWith('.html')) {
         res.setHeader('Content-Type', 'text/html; charset=utf-8');
       }
     }
   }
   ```
   Then `GET /a/:slug`:
   - Validate slug against `/^[a-z0-9-]+$/`; bad → `reply.callNotFound()`.
   - Look up slug in catalog cache; not found → `reply.callNotFound()`.
   - `reply.header('Content-Type', 'text/html; charset=utf-8')` (belt-and-suspenders).
   - `return reply.sendFile(`${slug}.html`)`.

3. **`src/server/routes/catalog.ts`** — `GET /` handler:
   - Read in-memory catalog cache (already newest-first per Phase 2).
   - Render the catalog HTML via `renderCatalogPage(entries)`.
   - `reply.header('Content-Type', 'text/html; charset=utf-8')`.
   - `return reply.send(html)`.

4. **`src/server/render/catalogPage.ts`** — `renderCatalogPage(entries: CatalogEntry[]): string`:
   - Returns a complete `<!DOCTYPE html>` document with inline `<style>` and a list of cards.
   - For each entry: thumbnail `<img src="${entry.thumbnailUrl}" alt="">`, `<h2>${entry.title}</h2>`, `<time datetime="${publishedAt}">${YYYY-MM-DD}</time>`, link `<a href="/a/${entry.slug}">`.
   - HTML-escape all text fields. No client JS in v1.

### Verification
```bash
npx tsc --noEmit

# Smoke: missing env throws
PORT= ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json npx tsx src/server.ts   # expect throw

# Smoke: full env starts
PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json npx tsx src/server.ts &
SERVER_PID=$!
sleep 1
curl -sI http://localhost:3000/                          # expect 200 text/html
curl -sI http://localhost:3000/a/nonexistent-slug        # expect 404
kill $SERVER_PID
```

### Acceptance criteria
- Server throws if any of `PORT`, `ARTICLES_DIR`, `CATALOG_PATH` is missing (NFR: no fallback).
- `GET /` returns 200 with `Content-Type: text/html; charset=utf-8` and lists every catalog entry, newest-first (AC4).
- `GET /a/:slug` for an existing slug returns 200 with `Content-Type: text/html; charset=utf-8` and body bytes identical to the file under `articles/` (full validation deferred to Phase 6).
- AC5 (stable URL across restart) and AC7 (persistence across restart) both follow from the catalog being on disk; manual confirm by restarting.
- AC6 (catalog click-through): clicking an entry navigates to the article URL.

---

## Phase 6 — Byte-Identity Verification Test

### Goal
An automated end-to-end test that proves AC3, AC9, and NFR11 hold for every published article.

### Tasks

1. **`test_scripts/verify-byte-identity.ts`** — implements the verification snippet from section "Verification Snippet" of `docs/research/fastify-static-byte-identical.md`:
   - Reads env `BASE_URL` (e.g. `http://localhost:3000`), `ARTICLES_DIR`, `CATALOG_PATH` — each required.
   - Loads catalog (Zod-validated).
   - For each entry:
     1. Reads `articles/<slug>.html` from disk → `diskHash`.
     2. Asserts `diskHash === entry.sha256` (catalog ↔ disk integrity).
     3. Issues a plain `node:http` GET against `${BASE_URL}/a/<slug>` with `Accept-Encoding: identity` and **no** `If-None-Match` / `If-Modified-Since` headers.
     4. Asserts `statusCode === 200` (specifically rejects 304 and 206 with explicit error messages).
     5. Asserts `Content-Encoding` header is absent or equals `'identity'`.
     6. Asserts `Content-Type` header contains both `text/html` and `utf-8`.
     7. Computes `sha256(response.body)` → `responseHash`.
     8. Asserts `responseHash === diskHash` (byte-identity end-to-end).
   - Prints `PASS` / `FAIL` per article; exits non-zero on any failure with a complete error list.

### Verification
```bash
# Phase-internal: with the server running and Phase 4's single article published,
# run the test against the 1-entry catalog.
PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json npx tsx src/server.ts &
SERVER_PID=$!
sleep 1
BASE_URL=http://localhost:3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json npx tsx test_scripts/verify-byte-identity.ts
kill $SERVER_PID
```

### Acceptance criteria (AC3, AC9, NFR11)
- For every catalog entry: `sha256(GET /a/<slug> body) === sha256(articles/<slug>.html)`.
- Every response carries `Content-Type: text/html; charset=utf-8`.
- No response carries a non-identity `Content-Encoding`.
- The script exits 0 with all PASS lines, non-zero on any mismatch.

---

## Phase 7 — Sample-Article Publication Run

### Goal
Publish all 7 sample articles end-to-end and confirm the full system on the real corpus.

### Tasks (sequential; record each command and output)

1. For each file in `samples/`, run `npm run publish-article -- "<path>"`.
2. For the Hermes-Agent file specifically: run with
   `--thumbnail-url=https://img.youtube.com/vi/zHE434sBw2U/maxresdefault.jpg`.
3. Confirm `data/catalog.json` now contains exactly 7 entries.
4. Start the server (`PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json npm start`).
5. Run `npm run verify` against the running server.
6. Spot-check via curl:
   ```bash
   curl -s http://localhost:3000/ | grep -F 'Deep Dive: /handoff is my new favourite skill'
   curl -s http://localhost:3000/ | grep -F 'https://img.youtube.com/vi/dtAJ2dOd3ko/maxresdefault.jpg'
   ```
7. Visual confirmation of the catalog page in a browser (resolves open ambiguity #2).
8. Restart the server; reconfirm catalog still lists all 7 (AC7).
9. Re-run a publish on an already-published file → assert exit 0, catalog unchanged (AC10).

### Acceptance criteria (AC1, AC2, AC3, AC4, AC5, AC6, AC7, AC9)
- AC1: catalog has exactly 7 entries.
- AC2: Matt Pocock entry shows title `Deep Dive: /handoff is my new favourite skill — Matt Pocock` and thumbnail `https://img.youtube.com/vi/dtAJ2dOd3ko/maxresdefault.jpg`.
- AC3 + AC9: `npm run verify` exits 0 — all 7 articles served byte-identical.
- AC4: catalog ordered newest-first (publishing 7 with sequential `publishedAt` proves it; if all 7 are published in the same minute, ordering is by exact ISO timestamp).
- AC5: each article URL persists across restart.
- AC6: clicking a catalog entry navigates to the article URL.
- AC7: post-restart catalog still shows 7 entries with original metadata.

---

## Phase 8 — Documentation Updates

### Goal
Capture the as-built design, functional requirements, and toolset references.

### Tasks

1. **`docs/design/project-design.md`** — write the as-built architecture document:
   - System overview diagram (textual is fine).
   - Component breakdown: server (article scope, catalog scope), catalog store, extractor, publish CLI.
   - Cite the investigation file (`docs/reference/investigation-html-article-publishing.md`) and both research files for every architectural decision (byte-identity guarantee, no-compression scope isolation, cheerio extraction, slug strategy).
   - Document the no-fallback configuration rule and its rationale.
   - Document the missing-img policy (`--thumbnail-url` override) and the re-publish policy (`--update` flag).

2. **`docs/design/project-functions.md`** — already created by this plan generation step (see separate file). Verify it reflects FR1–FR15.

3. **`Issues - Pending Items.md`** — verify:
   - Dependency vetting log has all pinned versions with dates.
   - Any deviations or follow-ups discovered during phases 1–7 are logged at the top (Pending Items section).

4. **Project `CLAUDE.md` — Tools section**: Append a concise reference entry for `publish-article` pointing to `docs/tools/publish-article.md` (the scaffold-produced file). Format per project convention:
   ```
   - **publish-article** — Ingests a source HTML file, extracts title + first <img>, copies the file byte-identically to `articles/<slug>.html`, computes SHA-256, and atomically appends to `data/catalog.json`. See `docs/tools/publish-article.md` for full documentation.
   ```

### Acceptance criteria
- `project-design.md` exists and cites all four upstream artifacts (refined-request, investigation, both research files).
- `project-functions.md` exists with FR1–FR15.
- `Issues - Pending Items.md` has a dated Dependency vetting log.
- `CLAUDE.md` Tools section references `docs/tools/publish-article.md`.

---

## Cross-Phase Verification Commands (cheat sheet)

```bash
node --version                                     # confirm LTS
npm install
npm audit                                          # MUST be 0 HIGH+
npx tsc --noEmit                                   # at any time, after any phase

# Extractor unit run
npx tsx test_scripts/extractor.test.ts

# Publish a sample
npm run publish-article -- "<source path>" [--thumbnail-url=<url>] [--update]

# Start server (env required)
PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json npm start

# Byte-identity verification
BASE_URL=http://localhost:3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json npx tsx test_scripts/verify-byte-identity.ts
```

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `@fastify/compress` accidentally registered globally → response gzipped → byte-identity broken | Use Pattern 1 (separate encapsulated scopes) from research file. Verification script forces `Accept-Encoding: identity` and asserts `Content-Encoding` absent. |
| Port conflict on startup | Required env var; no fallback. Fail loud, fix loud. |
| Slug collision (two articles with the same kebab-cased title) | `slug.ts` appends `-2`, `-3`, … against existing catalog slugs. Slug frozen at publish time. |
| Hermes-Agent article has no `<img>` | `--thumbnail-url=<URL>` CLI override is mandatory. HTML never modified. Without override, CLI exits 1 with code `NO_THUMBNAIL`. |
| ETag / 304 short-circuiting hides true response body | Verification script omits `If-None-Match` / `If-Modified-Since`, asserts `statusCode === 200`, treats 304/206 as test failure. |
| `preCompressed: true` accidentally enabled or `.gz`/`.br` sidecars placed in `articles/` | Locked to `false`. Never create sidecars. Document as project invariant in `project-design.md`. |
| `list` option on `@fastify/static` enabled (CVE-2026-6410) | Locked OFF. Never set. |
| Reverse proxy gzip introduced later | Out of v1 scope. If/when a proxy is introduced, the verification test must run through the proxy path AND proxy-level gzip must be disabled for `/a/*` paths. Add a follow-up item to `Issues - Pending Items.md` if/when a proxy is introduced. |
| Catalog read torn during atomic write | `fs.writeFile(<path>.tmp)` + `fs.rename()` is atomic on POSIX filesystems. |
| Network filesystem mtime precision causing stale ETag | Not anticipated for local dev / single-VM hosting. Document under Assumptions. |

---

## Pinned Versions (vet BEFORE adding)

| Package | Pin | Rationale |
|---|---|---|
| `fastify` | `^5` | Current major; required by `@fastify/static@^9.x` |
| `@fastify/static` | `^9.1.3` | Patches CVE-2026-6410, CVE-2026-6414, sendFile-option-override bug |
| `cheerio` | `^1.2.0` | Stable, no known direct advisories as of 2026-05-22 |
| `@sindresorhus/slugify` | `^2` | Modern, ESM-native; vet before pinning |
| `zod` | `^3` | Schema validation; vet before pinning |
| `typescript` | `^5` | Required for strict + NodeNext |
| `tsx` | `latest` | Dev runner; treat as a fast-moving package, pin freshly |
| `@types/node` | `^20` | Match LTS major |

**Vetting procedure** (from project `CLAUDE.md`):
1. `npm view <pkg> versions --json | tail -10` to confirm latest stable.
2. Check GitHub Advisory DB / `npm audit --package <pkg>@<version> --json`.
3. Pin caret against verified-clean version.
4. Log vetted-on date in `Issues - Pending Items.md` (Dependency vetting log).
5. Run `npm audit` post-install; zero HIGH+ advisories required to proceed.

---

## Acceptance-Criteria Traceability Matrix

| AC# | Description | Satisfied by |
|---|---|---|
| AC1 | 7 catalog entries after publishing 7 samples | Phase 7 |
| AC2 | Correct title + publication date + thumbnail per entry | Phases 3, 5, 7 (spot-check Matt Pocock) |
| AC3 | `sha256(GET /a/<slug>) === sha256(source)` for all 7 | Phase 6 + Phase 7 verify run |
| AC4 | Newest-first ordering in catalog | Phase 2 (sort on save) + Phase 5 (render order) |
| AC5 | Stable URLs across restart | Phase 4 (slug frozen) + Phase 2 (persistence) |
| AC6 | Catalog click-through to article | Phase 5 (catalog render anchor) |
| AC7 | Persistence across restart | Phase 2 (catalog on disk) + Phase 7 (manual restart) |
| AC8 | Single-command publish workflow | Phase 4 (`npm run publish-article`) |
| AC9 | Zero byte differences (no injection) | Phase 6 verification |
| AC10 | Idempotent re-publish (no duplicate entries) | Phase 4 re-publish check |
| NFR11 | `Content-Type: text/html; charset=utf-8`, no compression | Phases 5 + 6 |
| NFR12 | Single-command publishing workflow | Phase 4 |
| NFR13 | Portability | Plain Node.js + Fastify; deployable to any VM/container |
| NFR14 | Catalog under 2s | Plain HTML + inline CSS, no JS; trivial for 7–50 entries |
| NFR15 | Adding an article needs no downtime | Catalog hot-reload via `fs.watch` |

---

## Done When

- All 8 phases pass their acceptance criteria.
- `npm run verify` exits 0 against a running server with all 7 sample articles published.
- `Issues - Pending Items.md` has no critical pending items.
- `docs/design/project-design.md` and `docs/design/project-functions.md` are complete and cite upstream artifacts.
- `CLAUDE.md` Tools section references `docs/tools/publish-article.md`.
