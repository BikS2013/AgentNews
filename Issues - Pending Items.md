# Issues - Pending Items

This document tracks open issues, pending items, inconsistencies, and discrepancies detected during development of the Agent News HTML article publishing site. Pending items are listed at the top in priority order; completed items follow.

## Pending Items

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

**`npm audit` summary (2026-05-22):** 0 info / 0 low / 0 moderate / 0 high / 0 critical across 124 dependencies (93 prod, 32 dev, 27 optional). No overrides required.
