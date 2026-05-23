# Issues - Pending Items

This document tracks open issues, pending items, inconsistencies, and discrepancies detected during development of the Agent News HTML article publishing site. Pending items are listed at the top in priority order; completed items follow.

## Pending Items

### Design decision — workflow uses plain `git push --force`, not `--force-with-lease` (2026-05-23)

Symptom: second and subsequent runs of `publish-experimental.yml` failed with `[rejected] HEAD -> gh-pages (stale info)` even though no other writer touches the branch and the workflow's `concurrency` group serialises runs.

Cause: `--force-with-lease` (without an explicit lease value) needs an up-to-date remote-tracking ref to compare against. The workflow's `git clone --depth 1 --single-branch` is a shallow clone — git cannot reliably populate the remote-tracking metadata `--force-with-lease` consults, so it errors as "stale info" rather than risk an unsafe push. The first run happened to succeed because the branch state had just been created.

Resolution: switched the push to plain `git push --force`. The lease guard is unnecessary here because (a) the target branch has exactly one writer — this workflow, (b) the concurrency group already serialises runs, (c) the design intent is "replace prior content atomically on every run". Documented in `docs/design/project-design.md` and recorded here per the project's exception-recording rule.

### Design decision — `GH_PAT_EXPIRES_AT=never` accepted as a sentinel (2026-05-23)

Reason for the exception: GitHub classic PATs can be configured with no expiration date, and the user explicitly opted for that mode for this project's PAT. The workflow's PAT-expiration-warning step now accepts the literal string `never` as a valid value alongside ISO-8601 dates: it emits a `::notice::` and skips the date math. Documented in `docs/design/configuration-guide.md`; `Issues - Pending Items.md` carries this audit-trail entry per the project's CLAUDE.md rule about recording exceptions to the configuration policy. Note: GitHub fine-grained PATs always have an expiration, so the ISO-date path remains the recommended default; the `never` sentinel is for classic PATs only and gives up the proactive-renewal-warning property in exchange for matching the actual token state.

### Experimental sibling-publish — deferred configuration (2026-05-23, blocks first publish run only)

- **Target repo identity not yet provided (high, blocks publish)** — The cross-repo publish workflow (`.github/workflows/publish-experimental.yml`) reads `TARGET_REPO_OWNER` and `TARGET_REPO_NAME` from repository variables. Until those are set in the `agent-news` repo's Settings → Variables → Actions, the workflow's preflight step will fail fast with a named error and no network call is made. User must (a) create the target GitHub repository, (b) set the two variables. Until both are filled in, the build-and-push steps cannot run.
- **PAT not yet minted / `GH_PAT_EXPIRES_AT` not captured (high, blocks publish)** — The workflow requires a fine-grained PAT scoped to the target repo with `contents:write`, stored as the `GH_PAT` repository secret, AND a `GH_PAT_EXPIRES_AT` repository variable holding the PAT's ISO-8601 expiration date for the proactive-warning mechanism. Both must be set before the first run. The warning threshold is controlled by `GH_PAT_WARN_DAYS` (also required; recommend `14`).

### Minor — design/spec divergences surfaced by Phase 7 code review (2026-05-22, non-blocking)

- **CLI re-publish idempotency exits 3, not 0 (low)** — Design §5 step 5 specifies that re-publishing the same source file unchanged (same sha256) should be an idempotent no-op and exit 0. The current implementation in `src/cli/publish-article.ts` detects the collision by slug+title BEFORE computing sha256 and exits 3 with `ALREADY_PUBLISHED`. The catalog stays correct (no duplicate entry — AC10 satisfied in substance), but the exit code does not match the design contract. Recommended fix: compute sha256 first, then compare against any entry with the same `sourcePath`; if equal, exit 0; if different, require `--update`.
- **Hand-rolled validators instead of Zod (informational)** — Design §6 and plan-001 Phase 2 both call for Zod schemas (`CatalogEntrySchema`, `CatalogFileSchema`). The implementation in `src/catalog/types.ts` uses hand-rolled type-guard predicates (`isCatalogEntry`, `isCatalogFile`) and Zod is not a dependency. Functional behaviour (reject malformed entries) is preserved. Either update the design to document the chosen approach or add Zod.
- **`@sindresorhus/slugify` not used (informational)** — Plan-001 §9 pinned `@sindresorhus/slugify@^2`; the implementation uses a hand-rolled NFKD-based slugifier in `src/catalog/slug.ts` and the dependency is not installed. The hand-rolled version handles diacritics and the required regex correctly. Update the plan/design to reflect the chosen approach or add the dep.
- **`src/server.ts` auto-starts on import (low)** — `start()` is invoked at module level with no `import.meta.url === \`file://${process.argv[1]}\`` guard. Any future test or alternate entry-point that imports `src/server.ts` will start a listener. Recommended fix: wrap the bootstrap in an import-mainness guard mirroring the one in `src/cli/publish-article.ts`.
- **`tsconfig.json` `rootDir` vs `include` mismatch (informational)** — `rootDir` is `src` but `include` lists `test_scripts/**/*`. Currently safe because `test_scripts/` is empty; once Phase 9 lands code there, `tsc --noEmit` will report TS6059 ("File not under rootDir"). Recommended fix: move test scripts under `src/test_scripts/`, OR change `rootDir` to `./`, OR remove `rootDir` and let TypeScript infer it from `include`.

## Completed Items

- **Three-list home page (AI-News / Deep Dives / Articles) implemented** (2026-05-22): The catalog (`CatalogEntry`) and links (`LinkEntry`) schemas grew an optional `category` field (`'deep-dive' | 'ai-news'` and `'article' | 'ai-news'` respectively). The renderer at `src/server/render/catalog.ts` now partitions entries into three sections in order — AI-News (mixed videos + links), Deep Dives (videos), Articles (links) — with the lead-story "feature" treatment removed in favour of uniform grids; the header/footer nav was rewired to `#ai-news`, `#deep-dives`, `#articles`. Both CLIs (`publish-article`, `publish-link`) accept a new `--category` flag with validated values; absence preserves the existing category on `--update`, or omits the field on a fresh publish (the renderer falls back to the schema default). New agent-facing publishing contract written at `docs/PUBLISHING.md` (clone steps, the date-priority rule — YouTube/source date > agent-news date, title formatting, image referencing, three-list mapping, troubleshooting). Tool docs updated at `docs/tools/publish-article.md` and new `docs/tools/publish-link.md`. `npx tsc --noEmit` exits 0.

- **Hot-reload of `catalog.json` implemented** (2026-05-22): `CatalogStore` now exposes `startWatch({ debounceMs?, onError? })` and `stopWatch()`. The watcher uses `fs.watch` on the catalog's parent directory (not the file), filtered to the catalog's basename, with a default 150 ms debounce — this is robust against the atomic-rename publish protocol (the `.tmp -> rename` sequence would otherwise lose a single-file watcher's handle). Reload errors are routed to `onError` and the watcher keeps running; valid subsequent writes are picked up. Wired into `src/server.ts` between `store.load()` and the route registrations; `fastify.addHook('onClose', store.stopWatch)` releases the watcher cleanly. `onChange(listener)` is available for external observers. Verified by 6 new tests in `test_scripts/hot-reload.test.ts` (atomic-rewrite picks up, listener fires, stopWatch halts reloads, invalid JSON routes to onError without killing the watcher, startWatch is idempotent, stopWatch is idempotent and safe before start) and by a live end-to-end run: server kept running while a manual catalog edit (`9 → 8` entries) and a CLI re-publish (`8 → 9`) both triggered automatic reloads visible in the server log as `"catalog reloaded from disk"`. Resolves the open NFR15 ("adding an article needs no downtime") finding.

- **Phase 10 — Integration verification end-to-end PASS** (2026-05-22): `npm run typecheck` exits 0; `npm test` runs 147/147 tests passing (29 suites, 0 failed, 0 skipped); all 7 sample articles published via `npx tsx src/cli/publish-article.ts` (the Hermes article via `--thumbnail-url` override, the other six via auto-extraction); HTTP server started on port 3000, every `/a/<slug>` returned HTTP 200 with `Content-Type: text/html; charset=utf-8`, `Content-Encoding: identity`, and SHA-256 of the response body identical to both the on-disk `articles/<slug>.html` and the catalog's stored `sha256`; `GET /` returned HTTP 200 with `<title>Article Catalog</title>` and all 7 article titles substring-matched (apostrophe in Hermes title HTML-escaped as `&#39;`, which is correct escaping); `GET /a/does-not-exist` returned HTTP 404. Server stopped; catalog left populated for the user's `npm run dev` browse-through.

- **`package.json` test script added** (2026-05-22): `"test": "tsx --test test_scripts/*.test.ts"` is now present in `scripts`; `npm test` runs the entire suite (147 passing) and exits 0.

- **`tsconfig.json` `rootDir` resolved** (2026-05-22): `tsc --noEmit` exits 0 with the test files present under `test_scripts/`. The earlier TS6059 concern no longer applies.

- **Unit E — Project scaffolding** (2026-05-22): Created `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `articles/.gitkeep`, `data/catalog.json`. Ran `npm install` (98 packages, 0 vulnerabilities). Verified `npx tsc --noEmit` exits 0. A temporary `src/scaffold-placeholder.ts` was added so the TypeScript `include` glob has at least one input — Wave 2 coders may delete it once real source modules exist.

---

## Dependency vetting log

All entries are pinned to caret ranges against the verified clean version. Vetting performed per project CLAUDE.md `<dependency-vetting>` rules.

- 2026-05-22 — `fastify@^5.8.5` — latest stable major (5). `npm audit` reports 0 advisories.
- 2026-05-22 — `@fastify/static@^9.1.3` — latest 9.x; meets the CVE-patched minimum (>=9.1.3) flagged in `docs/research/cheerio-extraction.md` / `docs/research/fastify-static-security.md`. `npm audit` reports 0 advisories.
- 2026-05-22 — `cheerio@^1.2.0` — latest 1.x stable. `npm audit` reports 0 advisories.
- 2026-05-22 — `typescript@^6.0.3` — latest stable major (6). Dev-only. `npm audit` reports 0 advisories.
- 2026-05-22 — `tsx@^4.22.3` — latest stable major (4). Dev-only. `npm audit` reports 0 advisories.
- 2026-05-22 — `@types/node@^25.9.1` — latest stable major (25), matching engines.node `>=20`. Dev-only. Type definitions only — no runtime risk.
- 2026-05-23 — experimental sibling-publish feature — **no new runtime dependencies introduced.** The new CLI (`publish-experimental-article`) and the new build script (`build-experimental.ts`) reuse the existing toolchain (`tsx`, `fastify`'s shared render module, `cheerio` via the existing extractor) and add only TypeScript source files plus one YAML workflow.

**`npm audit` summary (2026-05-22):** 0 info / 0 low / 0 moderate / 0 high / 0 critical across 124 dependencies (93 prod, 32 dev, 27 optional). No overrides required.
