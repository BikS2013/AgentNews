---
language: typescript
framework: fastify
package_manager: npm
build_command: "tsc && node dist/server.js"
test_command: "tsx --test test_scripts/*.test.ts"
lint_command: "tsc --noEmit"
entry_points:
  - src/server.ts
  - src/cli/publish-article.ts
  - src/cli/publish-link.ts
  - scripts/build-static.ts
  - scripts/refresh-youtube-dates.ts
last_scanned_commit: 3d082f99f1a7651569a38c700f7164f69a3a641f
scanned_for_request: refined-request-experimental-sibling-publish.md
scanned_at: "2026-05-23T00:00:00Z"
---

# Codebase Scan — agent-news

## 1. Project Overview

TypeScript/ESM Node.js 20+ project publishing a Fastify 5 server that serves byte-identical HTML articles. Authors add content via two CLIs (`publish-article`, `publish-link`); a separate `scripts/build-static.ts` produces a static export for GitHub Pages. The project uses npm, `tsx` for TypeScript execution, and no bundler — everything is run directly via `tsx`. The source root is `src/`; adjacent `scripts/` holds one-off build/maintenance scripts; `data/` holds JSON catalog manifests; `articles/` and `samples/` hold HTML content.

---

## 2. Module Map

| Path | Purpose | Representative symbols |
|---|---|---|
| `src/cli/publish-article.ts` | CLI that copies HTML → `articles/<slug>.html` byte-identically and appends/updates a `CatalogEntry` in `data/catalog.json` | `parseArgs`, `main`, `atomicWriteFile` |
| `src/cli/publish-link.ts` | CLI that fetches an external URL's OG metadata and appends/updates a `LinkEntry` in `data/links.json`. Does NOT touch `articles/` or `data/catalog.json`. | `parseArgs`, `main` |
| `src/config.ts` | Loads `PORT`, `ARTICLES_DIR`, `CATALOG_PATH`, `LINKS_PATH` from env; throws on any missing/empty value — no fallbacks | `loadConfig`, `AppConfig` |
| `src/catalog/` | Catalog data layer: `store.ts` (CatalogStore, atomic write, hot-reload watcher), `types.ts` (CatalogEntry, isCatalogFile, CATALOG_CATEGORIES), `slug.ts` (slugify) | `CatalogStore`, `CatalogEntry`, `slugify` |
| `src/links/` | Links data layer: mirrors `src/catalog/` for `LinkEntry` / `LinksStore` / `data/links.json` | `LinksStore`, `LinkEntry`, `isLinksFile` |
| `src/extractor/` | HTML metadata extraction (`extract.ts`), YouTube video-id + publish-date fetch (`youtube.ts`), OG link metadata fetch (`link-metadata.ts`), error types (`errors.ts`) | `extractArticleMetadata`, `fetchYouTubeVideoPublishedAt`, `fetchLinkMetadata` |
| `src/server/` | Fastify routes (`routes/article.ts`, `routes/catalog.ts`) and the catalog HTML renderer (`render/catalog.ts`) | `articleRoute`, `catalogRoute`, `renderCatalogHtml` |
| `src/server.ts` | Fastify entry point; loads config, instantiates `CatalogStore` + `LinksStore`, registers routes and hot-reload watchers, starts listener | `start` |
| `scripts/build-static.ts` | Static export builder; reads `CATALOG_PATH`, `ARTICLES_DIR`, `LINKS_PATH`, `BASE_PATH`, `OUT_DIR`; emits `dist/index.html`, `dist/a/<slug>.html`, `dist/404.html`, `dist/.nojekyll` | `main`, `requireEnv`, `requireNonEmpty` |
| `scripts/refresh-youtube-dates.ts` | Maintenance script; backfills `youtubePublishedAt` on catalog entries without it | (standalone script) |
| `data/catalog.json` | Catalog manifest. Schema: `{ schemaVersion: 1, entries: CatalogEntry[] }` | — |
| `data/links.json` | Links manifest. Schema: `{ schemaVersion: 1, entries: LinkEntry[] }` | — |
| `articles/` | 12 published HTML files + `.gitkeep`. Production content. | — |
| `samples/` | 7 source HTML files used for test fixtures. Not served directly. | — |
| `test_scripts/` | 9 test files (node:test + assert/strict). Integration + unit. | — |
| `.github/workflows/` | One workflow: `deploy.yml` — push-to-main + workflow_dispatch, builds static site and deploys to GitHub Pages via `actions/deploy-pages@v4` | — |
| `docs/tools/` | Per-tool documentation: `publish-article.md`, `publish-link.md` | — |

---

## 3. Conventions

- **Module style**: ESM throughout (`"type": "module"` in `package.json`). Named imports (`import { CatalogStore } from '../catalog/store.js'`). File extensions `.js` in import paths (TS resolves to `.ts` sources via `tsx`). Observed in `src/cli/publish-article.ts:20-45`.

- **No-fallback config pattern**: Every env var required at startup is read through `requireEnv()` / `loadConfig()` which throw `Error` with a named message on any missing or empty value. No default substitution anywhere. `scripts/build-static.ts:53-77` shows the pattern for scripts; `src/config.ts:14-24` for the server.

- **Atomic write protocol**: Both the catalog store (`CatalogStore.atomicWrite`) and the article CLI (`atomicWriteFile` at `src/cli/publish-article.ts:242-262`) use open-write-fsync-close-rename-over-dest. This is the byte-identity preservation primitive and must be replicated for `experimental/`.

- **Byte-identity verification**: `scripts/build-static.ts:196-205` reads each article file into a `Buffer`, computes `sha256Hex(buf)`, compares against `entry.sha256`, and aborts on mismatch. The new experimental build must use the same guard.

- **Error hierarchy / exit codes**: CLIs use `UsageError` (exit 1), `IoError` (exit 2), `ConflictError` (exit 3). The exact same pattern must be reproduced in `publish-experimental-article`. Observed in `src/cli/publish-article.ts:182-210`.

- **Test style**: Node.js built-in test runner (`node:test`), `assert/strict`, `describe`/`it`/`before`/`after`. Tests create isolated temp dirs (UUID-based) and port 0 servers. Test files live under `test_scripts/` and match `*.test.ts`. Observed in `test_scripts/publish-cli-byte-identity.test.ts:20-53`.

---

## 4. Integration Points

### In-Scope

**`src/cli/publish-article.ts`** (full file, 583 lines)
- Entry point guard: lines 565-582 (`import.meta.url === file://...` check → calls `main()`).
- Argument parsing: `parseArgs()` at lines 87-180. Flags: `--source`, `--thumbnail-url`, `--update`, `--date`, `--category`.
- File-copy step (byte-identical): `atomicWriteFile(targetPath, buffer)` at lines 464-471. The destination is always `path.join(absArticlesDir, slug + '.html')` where `absArticlesDir = path.resolve(cwd, config.articlesDir)`.
- Catalog-write step: `store.append(entry)` or `store.updateBySlug(slug, ...)` at lines 533-557.
- Byte-identity preservation: single `readFileSync(absSource)` at line 335 → buffer passed unchanged to both `atomicWriteFile` (copy) and `sha256Hex` (hash). No transformation occurs between read and write.
- Config dependency: `loadConfig()` at line 317 supplies `articlesDir` and `catalogPath`. The new CLI must supply its own config loading for `EXPERIMENTAL_DIR` and `EXPERIMENTAL_CATALOG_PATH` — it MUST NOT reuse `config.articlesDir` or `config.catalogPath`.
- **Planner action**: Scaffold `publish-experimental-article` as a clone of this file. Change `articlesDir` → `experimentalDir`, `catalogPath` → `experimentalCatalogPath`, `articlePath` field value (`articles/<slug>.html` → `experimental/<slug>.html`). The existing file is read-only per the project constraint.

**`scripts/build-static.ts`** (full file, 233 lines)
- Config reading: lines 130-139 read `CATALOG_PATH`, `ARTICLES_DIR`, `LINKS_PATH`, `BASE_PATH`, `OUT_DIR` via `requireNonEmpty` / `requireBasePath`. The new experimental build script must read a parallel set (`EXPERIMENTAL_CATALOG_PATH`, `EXPERIMENTAL_DIR`, `BASE_PATH`, `OUT_DIR`).
- Catalog iteration: lines 162-175 parse + validate `isCatalogFile(parsed)`; line 162 assigns `entries: CatalogEntry[]`. This loop drives all downstream output — the new script iterates `experimental-catalog.json` entries instead.
- File emission: lines 189-205 loop `entries`, read `articles/<entry.slug>.html`, verify SHA-256, write to `dist/a/<slug>.html`. The experimental build must emit to `dist/experimental/<slug>.html` (or `dist/a/<slug>.html` in a separate `dist/` — planner to decide path layout per Open Question 2).
- Catalog page: line 185 calls `renderCatalogHtml(entries, { links, basePath })`. The experimental build can reuse `renderCatalogHtml` for the experimental catalog index.
- No sitemap generation currently exists in `build-static.ts`. The exclusion guard concern is simpler: the main build only reads `data/catalog.json` and iterates its entries; it will never touch experimental content as long as `data/experimental-catalog.json` is never passed to it. The planner must verify there is no glob over `articles/` or `data/` that could accidentally pick up experimental files.
- **Planner action**: Create `scripts/build-experimental.ts` modelled on `build-static.ts`. Add `"build:experimental": "tsx scripts/build-experimental.ts"` to `package.json`. No changes to `build-static.ts` itself are required to achieve exclusion — the existing script is already scoped by explicit env var paths.

**`data/catalog.json`** — Schema (from inspection):
```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "slug": "<kebab-case-string>",
      "title": "<string>",
      "publishedAt": "<ISO-8601>",
      "sourcePath": "<relative-or-absolute-path>",
      "articlePath": "articles/<slug>.html",
      "thumbnailUrl": "<URL>",
      "thumbnailSource": "html | cli-override",
      "sha256": "<hex-string>",
      "youtubePublishedAt": "<ISO-8601>",  // optional
      "category": "deep-dive | ai-news"   // optional
    }
  ]
}
```
`data/experimental-catalog.json` must use the same schema. The `articlePath` field will contain `experimental/<slug>.html` instead of `articles/<slug>.html`. The two files must remain disjoint (no slug overlap enforced by the separate writer CLIs).

**`articles/`** — 12 files at one level:
`.gitkeep`, `building-pi-in-a-world-of-slop-deep-dive.html`, `deep-dive-building-agent-harnesses-for-large-codebases-cole-medin.html`, `deep-dive-cooking-with-agents-in-vs-code-liam-hampton.html`, `deep-dive-handoff-is-my-new-favourite-skill-matt-pocock.html`, `deep-dive-i-gave-my-hermes-agent-a-phone-number-it-s-crazy.html`, `deep-dive-opus-4-7-and-openai-5-5-made-your-prompting-style-obsolete-nate-b-jones.html`, `deep-dive-scaling-agents-on-kubernetes-with-acpx-and-acp.html`, `deep-dive-the-perfect-zsh-setup-for-2026-dreams-of-code.html`, `i-stopped-using-grill-me-for-coding-deep-dive.html`, `pi-to-pi-two-way-agent-orchestration-deep-dive.html`, `simple-pi-subagents-deep-dive.html`, `the-one-ai-writing-hack-nobody-talks-about-deep-dive.html`.

**`samples/`** — 7 source HTML files (test fixtures, not served). Used by `test_scripts/publish-cli-byte-identity.test.ts` as `SAMPLES_DIR`.

**`package.json` scripts** — verbatim listing:
```json
"dev": "tsx src/server.ts",
"start": "tsc && node dist/server.js",
"publish-article": "tsx src/cli/publish-article.ts",
"publish-link": "tsx src/cli/publish-link.ts",
"verify": "tsx test_scripts/verify-byte-identity.ts",
"typecheck": "tsc --noEmit",
"test": "tsx --test test_scripts/*.test.ts",
"build:static": "tsx scripts/build-static.ts",
"refresh-youtube-dates": "tsx scripts/refresh-youtube-dates.ts"
```
New scripts to add (no collisions): `"publish-experimental-article": "tsx src/cli/publish-experimental-article.ts"`, `"build:experimental": "tsx scripts/build-experimental.ts"`.

**`.github/workflows/`** — One existing workflow: `deploy.yml`. It runs on `push: branches: [main]` and `workflow_dispatch`; uses `actions/deploy-pages@v4` with `pages: write` and `id-token: write` permissions to push to the `agent-news` repo's own GitHub Pages. The new `publish-experimental.yml` workflow must NOT reuse these permissions — it must use `GH_PAT` with `contents:write` on the target repo instead, and require `TARGET_REPO_OWNER`, `TARGET_REPO_NAME`, `TARGET_BRANCH`, and `GH_PAT` as explicit inputs/secrets with fail-fast checks.

**`test_scripts/`** — 9 files:
`.gitkeep`, `catalog-renderer.test.ts`, `config.test.ts`, `extractor.test.ts`, `hot-reload.test.ts`, `publish-cli-byte-identity.test.ts`, `slug.test.ts`, `smoke-three-sections.ts`, `store.test.ts`, `types.test.ts`.
New regression tests must follow the same `node:test` + `assert/strict` pattern. Model the exclusion-verification test on `publish-cli-byte-identity.test.ts` (UUID temp dirs, explicit env vars, no shared state with the project-root `articles/` or `data/catalog.json`).

**`docs/tools/`** — Two existing files: `publish-article.md`, `publish-link.md`. The new `publish-experimental-article` CLI must get a `docs/tools/publish-experimental-article.md` scaffolded via `/tool-conventions scaffold publish-experimental-article`.

**`Issues - Pending Items.md`** — 4 open items (all minor/informational, non-blocking):
1. CLI re-publish idempotency exits 3 instead of 0 (low).
2. Hand-rolled validators instead of Zod (informational).
3. `@sindresorhus/slugify` not used (informational).
4. `src/server.ts` auto-starts on import (low).
None of these collide with the experimental feature. The planner should add a new pending item for the experimental flow's open questions (target repo identity, site shape, authoring CLI shape) and a dependency vetting log entry for any new runtime dep introduced by the experimental build.

### Out-of-Scope

The following modules are NOT touched by this feature:

- `src/server.ts` — serves `ARTICLES_DIR` + `CATALOG_PATH` only. Config is loaded from env at startup. No server change is required; the experimental site is a separate static artifact served by GitHub Pages, not by the Fastify server.
- `src/config.ts` — `AppConfig` covers server-only env vars. The new CLI/script will read its own env vars directly (same `requireEnv` pattern, not extending `AppConfig`).
- `src/catalog/store.ts`, `src/catalog/types.ts`, `src/catalog/slug.ts` — the new CLI may IMPORT and REUSE `CatalogStore`, `CatalogEntry`, `slugify` from these modules (they are path-agnostic). No changes to these files.
- `src/links/` — the experimental feature has no links concept; `data/links.json` is out of scope.
- `src/extractor/` — reused as-is for HTML metadata extraction in the new CLI; no changes.
- `src/server/render/catalog.ts` — `renderCatalogHtml` can be reused by the experimental build script; no changes.
- `data/catalog.json` — read-only from the perspective of this feature. The new CLI must NEVER write to it.
- `articles/` — read-only. The new CLI must NEVER write to it.
- `src/cli/publish-article.ts` — read-only per the project constraint. Do not add `--experimental` flag to it.
- `src/cli/publish-link.ts` — read-only; writes only to `data/links.json`, no relevance to experimental flow.
- `scripts/build-static.ts` — no modifications required. The existing script is already scoped to `CATALOG_PATH`/`ARTICLES_DIR` via explicit env vars and will not pick up experimental content as long as those vars are not pointed at experimental paths.
- `scripts/refresh-youtube-dates.ts` — out of scope.

### New Integration Points

| New artifact | Landing location | Notes |
|---|---|---|
| `experimental/` folder | Project root (sibling to `articles/`) | Must contain `.gitkeep` initially; byte-identical HTML files authored via new CLI |
| `data/experimental-catalog.json` | `data/` (sibling to `catalog.json`) | Same schema as `catalog.json`; `articlePath` values use `experimental/` prefix; initialise as `{ "schemaVersion": 1, "entries": [] }` |
| `src/cli/publish-experimental-article.ts` | `src/cli/` | Clone of `publish-article.ts`; reads `EXPERIMENTAL_DIR` + `EXPERIMENTAL_CATALOG_PATH` env vars; never writes to `articles/` or `data/catalog.json` |
| `scripts/build-experimental.ts` | `scripts/` | Clone of `build-static.ts`; reads `EXPERIMENTAL_CATALOG_PATH`, `EXPERIMENTAL_DIR`, `BASE_PATH`, `OUT_DIR`; no `LINKS_PATH` needed unless experimental site gets a links section |
| `.github/workflows/publish-experimental.yml` | `.github/workflows/` | New workflow; triggers on `workflow_dispatch` + path-filtered push (`experimental/**`, `data/experimental-catalog.json`); fail-fast config check; force-push to target repo via `GH_PAT` |
| `docs/tools/publish-experimental-article.md` | `docs/tools/` | Scaffolded via `/tool-conventions scaffold publish-experimental-article` |
| `docs/design/configuration-guide.md` | `docs/design/` | New file documenting all env vars including `TARGET_REPO_OWNER`, `TARGET_REPO_NAME`, `TARGET_BRANCH`, `GH_PAT`, `GH_PAT_EXPIRES_AT` |
| `test_scripts/experimental-build.test.ts` | `test_scripts/` | Regression tests: byte-identity of experimental HTML end-to-end + zero-leakage into public build |

---

## 5. Notes

- **No sitemap generation** in the current `build-static.ts`. The refined request mentions "no sitemap entries" in the exclusion requirement (Req §4) but there is currently no sitemap emitted by the public build. The planner may note this as already-satisfied, but should add a regression test assertion to detect if sitemap generation is ever added later.

- **`build-static.ts` does not glob `articles/`** — it iterates only `entries` from the parsed `data/catalog.json`. This means the exclusion guarantee already holds structurally: pointing the script at `data/catalog.json` (which will never contain experimental slugs) is sufficient. No explicit exclusion guard code needs to be injected into `build-static.ts`.

- **`LINKS_PATH` is required by `build-static.ts`** (line 132). The experimental build script will need to decide: either require a `LINKS_PATH` for the experimental site (even if initially an empty `{ "schemaVersion": 1, "entries": [] }` file) or fork the script to make `LINKS_PATH` optional. The planner should align with Open Question 2 (site shape).

- **Open Items from `Issues - Pending Items.md` that the new feature must not regress**: The `tsconfig.json` `rootDir` concern is already resolved. The `src/server.ts` auto-start issue (item 4) means that the new CLI must NOT import `src/server.ts` — it must import only the catalog/extractor modules directly (same pattern as the existing `publish-article.ts`).
