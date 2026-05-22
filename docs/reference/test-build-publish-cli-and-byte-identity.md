---
status: completed
mode: write-and-run
scope_slug: publish-cli-and-byte-identity
language: TypeScript
framework: node:test
test_command_full: npx tsx --test test_scripts/publish-cli-byte-identity.test.ts
test_command_scope: npx tsx --test test_scripts/publish-cli-byte-identity.test.ts
test_dir: test_scripts/
target_path: /Users/giorgosmarinos/aiwork/coding-platform/agent-news
test_files_owned:
  - test_scripts/publish-cli-byte-identity.test.ts
tests_added: 18
tests_updated: 0
tests_run: 18
tests_passed: 18
tests_failed: 0
implementation_gaps: 0
built_at: 2026-05-22T00:00:00Z
last_built_commit: null
---

# Test Build — Publish CLI + HTTP Byte-Identity Integration

## 1. Summary

Status: **completed** — all 18 tests pass. Framework: `node:test` with `tsx` as
the TypeScript runner (no test framework was previously configured; `node:test`
is the Node.js built-in, requiring zero new dependencies). The suite exercises
the publish-article CLI (exit codes 0/1/3, conflict detection, `--thumbnail-url`
override), the Fastify HTTP server routes (`GET /a/:slug`, `GET /`), and the
primary acceptance criterion AC1 (byte-identity for all 7 sample articles).
AC1 is **verified**: for every article, `sha256(GET /a/<slug> response body)`
equals `sha256(source file)` equals the catalog's stored `sha256`.

## 2. Scope Resolved

**Source files under test:**

- `src/cli/publish-article.ts` — `main()`, `parseArgs()`, `atomicWriteFile()`,
  `sha256Hex()`, `toProjectRelative()`, `validateIsoDate()`, exit codes 0/1/2/3.
- `src/server.ts` — `start()` (not imported directly; equivalent setup inlined
  in tests to avoid the top-level auto-run side effect).
- `src/server/routes/article.ts` — `articleRoute()`, slug regex validation,
  catalog lookup, byte-identity headers (`Content-Type`, `Content-Encoding`).
- `src/server/routes/catalog.ts` — `catalogRoute()`, catalog snapshot, HTML
  rendering integration.

**Supporting modules read but not directly under test here:**

- `src/catalog/store.ts` — used in test infrastructure to verify catalog state.
- `src/catalog/types.ts` — schema used implicitly.
- `src/config.ts` — `loadConfig()` is exercised by the CLI subprocess.
- `src/extractor/extract.ts` — exercised indirectly by the CLI subprocess.
- `src/server/render/catalog.ts` — exercised via `GET /`.

## 3. Existing Coverage

No existing test files were found for any of the in-scope symbols. The
`test_scripts/` directory contained only a `.gitkeep` placeholder.

| Symbol | Existing test files |
|---|---|
| `main` (publish-article CLI) | none |
| `articleRoute` | none |
| `catalogRoute` | none |
| `start` (server.ts) | none |

## 4. Plan

| # | target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|---|
| 1 | `main` | unit | publish-cli-byte-identity.test.ts | publishes first article — exit 0, valid JSON, disk SHA matches source | Verifies basic publish path: exit 0, catalog entry written, disk file is byte-identical to source. |
| 2 | `main` | unit | publish-cli-byte-identity.test.ts | publishes second article — catalog has two entries | Verifies sequential publish accumulates entries correctly. |
| 3 | `main` | error_path | publish-cli-byte-identity.test.ts | exits 1 with NO_THUMBNAIL when no --thumbnail-url | Verifies the no-thumbnail policy: article without `<img>` and no flag → exit 1 + NO_THUMBNAIL. |
| 4 | `main` | unit | publish-cli-byte-identity.test.ts | exits 0 with thumbnailSource=cli-override when --thumbnail-url supplied | Verifies --thumbnail-url override path produces correct catalog fields. |
| 5 | `main` | error_path | publish-cli-byte-identity.test.ts | exits 3 with ALREADY_PUBLISHED without --update | Verifies conflict detection for re-publish of same article. |
| 6 | `main` | unit | publish-cli-byte-identity.test.ts | exits 0 and preserves publishedAt/slug on --update | Verifies --update path preserves immutable fields and does not create a duplicate entry. |
| 7–13 | `articleRoute` | integration | publish-cli-byte-identity.test.ts | byte-identity: GET /a/<slug> === source file (×7) | AC1: for each of the 7 samples, verifies status 200, correct Content-Type, no compression, sha256(response) === sha256(source). |
| 14 | `articleRoute` | error_path | publish-cli-byte-identity.test.ts | GET /a/does-not-exist returns 404 | Verifies unknown slug → 404. |
| 15 | `articleRoute` | error_path | publish-cli-byte-identity.test.ts | GET /a/INVALID..SLUG returns 404 | Verifies slug-regex rejection (uppercase + dots) returns 404 before catalog lookup. |
| 16 | `catalogRoute` | integration | publish-cli-byte-identity.test.ts | GET / returns 200 with correct Content-Type and `<title>Article Catalog</title>` | Verifies catalog index page is served as HTML with the expected title element. |
| 17 | `catalogRoute` | integration | publish-cli-byte-identity.test.ts | GET / catalog page contains links to all 7 published articles | Verifies all article slugs appear as hrefs in the rendered catalog page. |
| 18 | setup | integration | publish-cli-byte-identity.test.ts | all 7 samples published into temp catalog | Verifies the setup (before hook) successfully published all 7 articles without any exit-code failures. |

## 5. Files Owned

| File | Reason |
|---|---|
| `test_scripts/publish-cli-byte-identity.test.ts` | new — created from scratch |

## 6. Test Run Results

```
▶ CLI smoke tests
  ✔ publishes first article — exit 0, valid JSON on stdout, disk SHA matches source SHA (439ms)
  ✔ publishes second article — exit 0, catalog now has two entries (434ms)
✔ CLI smoke tests (876ms)

▶ CLI no-thumbnail policy — Hermes article
  ✔ exits 1 with NO_THUMBNAIL when Hermes article published without --thumbnail-url (432ms)
  ✔ exits 0 with thumbnailSource=cli-override when --thumbnail-url is supplied (441ms)
✔ CLI no-thumbnail policy — Hermes article (875ms)

▶ CLI conflict detection
  ✔ exits 3 with ALREADY_PUBLISHED when same article is published again without --update (424ms)
  ✔ exits 0 and preserves publishedAt and slug when --update is supplied (441ms)
✔ CLI conflict detection (1308ms)

▶ HTTP byte-identity — all 7 articles (AC1)
  ✔ all 7 samples are published into the temp catalog (0.1ms)
  ✔ byte-identity: GET /a/<slug> === source — "Deep Dive — _handoff is my new favourite skill (Matt Pocock)" (7ms)
  ✔ byte-identity: GET /a/<slug> === source — "Deep Dive — Anthropic Masterclass Agent Harnesses (Cole Medin)" (1ms)
  ✔ byte-identity: GET /a/<slug> === source — "Deep Dive — Cooking with Agents in VS Code (Liam Hampton, Microsoft)" (0.9ms)
  ✔ byte-identity: GET /a/<slug> === source — "Deep Dive — Hermes Agent Phone Number (David Ondrej)" (0.7ms)
  ✔ byte-identity: GET /a/<slug> === source — "Deep Dive — Opus 4.7 & OpenAI 5.5 Made Your Prompting Style Obsolete (Nate B Jones)" (0.7ms)
  ✔ byte-identity: GET /a/<slug> === source — "Deep Dive — Scaling Agents on Kubernetes with ACPX and ACP (Onur Solmaz, OpenClaw)" (0.6ms)
  ✔ byte-identity: GET /a/<slug> === source — "Deep Dive — The Perfect Zsh Setup For 2026 (Dreams of Code)" (0.7ms)
  ✔ GET /a/does-not-exist returns 404 (0.5ms)
  ✔ GET /a/INVALID..SLUG returns 404 (slug regex rejects uppercase and dots) (0.6ms)
  ✔ GET / returns 200, Content-Type text/html, contains <title>Article Catalog</title> (0.7ms)
  ✔ GET / catalog page contains links to all 7 published articles (0.3ms)
✔ HTTP byte-identity — all 7 articles (AC1) (3120ms)

ℹ tests 18  |  suites 4  |  pass 18  |  fail 0  |  cancelled 0  |  skipped 0  |  todo 0
ℹ duration_ms 6374
```

No failures. Exit code 0.

## 7. Implementation Gaps

None. All 18 tests passed on first run after fixing the test infrastructure
(stdout capture conflict with test runner — see §9 Commands Run). No
production behavior was found to deviate from the design specification.

## 8. Manual Review Needed

### 1. No `test` script in package.json

`package.json` does not have a `scripts.test` field. A sibling test-builder
may need to add one. To avoid a race condition, this agent did NOT add the
script. Recommended addition (to be made by the orchestrator or human, not
another parallel agent):

```json
"test": "npx tsx --test test_scripts/**/*.test.ts"
```

### 2. `src/server.ts` top-level auto-run side effect

`src/server.ts` has an unconditional top-level call to `start()` that fires
on import. This prevents the test suite from importing `start()` directly.
The test suite works around this by constructing the Fastify instance inline
using the same plugin and route registrations. If `start()` ever needs to
be tested in isolation, the auto-run guard should be made conditional (e.g.
`if (import.meta.url === \`file://\${process.argv[1]}\``) — the same pattern
already used in `publish-article.ts`.

## 9. Commands Run

| # | Command | Exit code |
|---|---|---|
| 1 | `npx tsx --test test_scripts/publish-cli-byte-identity.test.ts` | 1 (first run — stdout capture conflict with test runner) |
| 2 | Rewrote test to use `spawnSync` for CLI calls instead of capturing `process.stdout.write` | — |
| 3 | `npx tsx --test test_scripts/publish-cli-byte-identity.test.ts` | 0 (18/18 pass) |
