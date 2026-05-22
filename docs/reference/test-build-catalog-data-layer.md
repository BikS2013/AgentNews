---
status: completed
mode: write-and-run
scope_slug: catalog-data-layer
language: TypeScript
framework: node:test (Node.js built-in)
test_command_full: node --import tsx --test test_scripts/*.test.ts
test_command_scope: node --import tsx --test test_scripts/slug.test.ts test_scripts/types.test.ts test_scripts/config.test.ts test_scripts/store.test.ts
test_dir: test_scripts
target_path: /Users/giorgosmarinos/aiwork/coding-platform/agent-news
test_files_owned:
  - test_scripts/slug.test.ts
  - test_scripts/types.test.ts
  - test_scripts/config.test.ts
  - test_scripts/store.test.ts
tests_added: 129
tests_updated: 0
tests_run: 129
tests_passed: 129
tests_failed: 0
implementation_gaps: 0
built_at: 2026-05-22T00:00:00Z
last_built_commit: null
---

# Test Build — Catalog Data Layer

## 1. Summary

Status: completed. Framework: Node.js built-in `node:test` (no new dependencies added). Four new test files were created under `test_scripts/` covering `src/catalog/slug.ts`, `src/catalog/types.ts`, `src/catalog/store.ts`, and `src/config.ts`. 129 tests were written and executed; all 129 pass. One test-bug (wrong expected value for apostrophe-in-title slug case) was detected and fixed before the final run. Zero implementation gaps identified.

## 2. Scope Resolved

- `src/catalog/slug.ts`
  - `slugify(title: string, taken: ReadonlySet<string>): string`
- `src/catalog/types.ts`
  - `CatalogEntry` (interface)
  - `CatalogFile` (interface)
  - `isCatalogEntry(value: unknown): value is CatalogEntry`
  - `isCatalogFile(value: unknown): value is CatalogFile`
- `src/catalog/store.ts`
  - `CatalogStore` (class) — methods: `load()`, `snapshot()`, `getBySlug()`, `existingSlugs()`, `append()`, `updateBySlug()`
- `src/config.ts`
  - `loadConfig(env?: NodeJS.ProcessEnv): AppConfig`
  - `AppConfig` (interface)

## 3. Existing Coverage

No existing test files were found for any of the in-scope symbols. The `test_scripts/` directory contained only a `.gitkeep` placeholder prior to this build.

| Symbol | Existing test files |
|---|---|
| `slugify` | none |
| `isCatalogEntry` | none |
| `isCatalogFile` | none |
| `CatalogStore` | none |
| `loadConfig` | none |

## 4. Plan

### `src/catalog/slug.ts` — `slugify`

| # | target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|---|
| 1 | slugify | unit | slug.test.ts | lowercases an all-caps title | Proves basic case normalisation |
| 2 | slugify | unit | slug.test.ts | converts spaces to hyphens | Proves space→hyphen mapping |
| 3 | slugify | unit | slug.test.ts | collapses multiple spaces into one hyphen | Proves run collapse |
| 4 | slugify | unit | slug.test.ts | trims leading and trailing hyphens | Proves trim step |
| 5 | slugify | unit | slug.test.ts | retains digits | Proves numeric chars pass through |
| 6 | slugify | unit | slug.test.ts | collapses a run of hyphens into one | Proves hyphen-run collapse |
| 7 | slugify | unit | slug.test.ts | handles a single word | Proves single-token path |
| 8 | slugify | unit | slug.test.ts | replaces non-alnum non-hyphen chars with spaces then collapses | Proves disallowed char substitution |
| 9 | slugify | unit | slug.test.ts | strips accents from é | Proves NFKD+combining-mark strip |
| 10 | slugify | unit | slug.test.ts | strips accents from ü, ö, ä | Proves German umlauts stripped |
| 11 | slugify | unit | slug.test.ts | strips accents from ñ | Proves Spanish tilde stripped |
| 12 | slugify | unit | slug.test.ts | strips accents from ç | Proves cedilla stripped |
| 13 | slugify | unit | slug.test.ts | strips accents from à, â, ê, î, ô, û | Proves French circumflex/grave stripped |
| 14 | slugify | unit | slug.test.ts | preserves base ASCII letters after NFKD normalisation | Proves NFKD round-trip is lossless for base chars |
| 15 | slugify | unit | slug.test.ts | returns base slug when no collision | Proves happy-path no suffix |
| 16 | slugify | unit | slug.test.ts | appends -2 when base is taken | Proves first collision gets -2 |
| 17 | slugify | unit | slug.test.ts | appends -3 when base and -2 are taken | Proves second collision gets -3 |
| 18 | slugify | unit | slug.test.ts | appends -4 when base, -2, -3 are taken | Proves third collision gets -4 |
| 19 | slugify | unit | slug.test.ts | skips to next free suffix when intermediate suffixes not taken | Proves suffix starts at 2, not random |
| 20 | slugify | unit | slug.test.ts | does not modify the taken set (no mutation) | Proves no side-effects |
| 21 | slugify | unit | slug.test.ts | suffix counter is independent per call | Proves no shared state between calls |
| 22 | slugify | error_path | slug.test.ts | throws on a title that is only special characters | Proves empty-after-strip raises |
| 23 | slugify | error_path | slug.test.ts | throws on a title consisting solely of hyphens | Proves hyphen-only raises |
| 24 | slugify | error_path | slug.test.ts | throws on a title of only whitespace | Proves whitespace-only raises |
| 25 | slugify | error_path | slug.test.ts | throws on an empty string | Proves empty raises |
| 26 | slugify | error_path | slug.test.ts | throws when all chars are diacritics that strip to nothing | Proves combining-mark-only raises |
| 27–35 | slugify | unit | slug.test.ts | slug for "X" matches /^[a-z0-9]+(-[a-z0-9]+)*$/ (9 cases) | Proves final regex assertion holds for real-world titles |

### `src/catalog/types.ts` — `isCatalogFile`, `isCatalogEntry`

| # | target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|---|
| 36 | isCatalogFile | unit | types.test.ts | accepts a valid file with one entry | Happy-path golden path |
| 37 | isCatalogFile | unit | types.test.ts | accepts a valid file with an empty entries array | Edge case: empty catalog is valid |
| 38 | isCatalogFile | unit | types.test.ts | accepts thumbnailSource "cli-override" | Proves both enum values accepted |
| 39–40 | isCatalogFile | unit | types.test.ts | accepts ISO timestamp with TZ offset / fractional seconds | Proves ISO-8601 regex breadth |
| 41–44 | isCatalogFile | unit | types.test.ts | rejects schemaVersion 2/0/"1"/missing | Proves version guard is exact-equality |
| 45–50 | isCatalogFile | unit | types.test.ts | rejects missing entries/updatedAt/null/undefined/string/array | Proves all required fields checked |
| 51–54 | isCatalogFile | unit | types.test.ts | rejects non-array entries/null entries/bad updatedAt/numeric updatedAt | Proves type guards on fields |
| 55–57 | isCatalogFile | unit | types.test.ts | rejects files with invalid entries | Proves entry validation is transitive |
| 58–65 | isCatalogEntry | unit | types.test.ts | slug validation (8 cases) | Proves SLUG_REGEX applied correctly |
| 66–70 | isCatalogEntry | unit | types.test.ts | sha256 validation (5 cases) | Proves SHA256_REGEX applied correctly |
| 71–74 | isCatalogEntry | unit | types.test.ts | thumbnailSource validation (4 cases) | Proves enum guard |
| 75–79 | isCatalogEntry | unit | types.test.ts | publishedAt validation (4 cases) | Proves ISO_8601_REGEX on entry field |

### `src/config.ts` — `loadConfig`

| # | target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|---|
| 80 | loadConfig | unit | config.test.ts | returns correctly typed config with valid env vars | Happy-path golden path |
| 81 | loadConfig | unit | config.test.ts | port is a number, not a string | Proves type coercion |
| 82–84 | loadConfig | unit | config.test.ts | accepts port 1 / 65535 / with + sign | Proves boundary and format variations |
| 85–86 | loadConfig | unit | config.test.ts | trims whitespace from ARTICLES_DIR / CATALOG_PATH | Proves trim step |
| 87–89 | loadConfig | config_validation | config.test.ts | throws when PORT undefined/empty/"does not fall back" | Proves no-fallback contract |
| 90–92 | loadConfig | config_validation | config.test.ts | throws when ARTICLES_DIR undefined/empty/whitespace-only | Proves no-fallback contract |
| 93–95 | loadConfig | config_validation | config.test.ts | throws when CATALOG_PATH undefined/empty/whitespace-only | Proves no-fallback contract |
| 96–103 | loadConfig | error_path | config.test.ts | invalid PORT values (8 cases: 0, negative, decimal, scientific, hex, alpha, >65535) | Proves all non-positive-integer forms rejected |

### `src/catalog/store.ts` — `CatalogStore`

| # | target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|---|
| 104–108 | CatalogStore.load | error_path | store.test.ts | throws on missing file / invalid JSON / wrong schemaVersion / missing fields / invalid entry | Proves load() raises on all bad inputs |
| 109–110 | CatalogStore.load | unit | store.test.ts | loads empty catalog / catalog with one entry | Proves load() caches correctly |
| 111 | CatalogStore.snapshot | error_path | store.test.ts | throws before load() is called | Proves assertLoaded() guard |
| 112 | CatalogStore.snapshot | unit | store.test.ts | returns a frozen array | Proves Object.freeze applied |
| 113 | CatalogStore.snapshot | unit | store.test.ts | returns an independent copy | Proves snapshot is a deep copy |
| 114–119 | CatalogStore.append | unit | store.test.ts | appends entry / throws duplicate slug / two different slugs / JSON parses / no .tmp file / re-loads cache | Proves append + atomic write |
| 120–127 | CatalogStore.updateBySlug | unit/error_path | store.test.ts | throws on missing slug / updates mutable field / preserves slug / preserves publishedAt / ignores slug in patch / persists / no .tmp / updates only targeted entry | Proves update semantics and immutability |
| 128–129 | CatalogStore.getBySlug / existingSlugs | error_path | store.test.ts | throw before load() | Proves assertLoaded() guard on both |

## 5. Files Owned

| File | Reason |
|---|---|
| `test_scripts/slug.test.ts` | new — no prior coverage |
| `test_scripts/types.test.ts` | new — no prior coverage |
| `test_scripts/config.test.ts` | new — no prior coverage |
| `test_scripts/store.test.ts` | new — no prior coverage |

All four files were freshly created. No existing test file was modified.

## 6. Test Run Results

Command executed:
```
node --import tsx --test test_scripts/slug.test.ts test_scripts/types.test.ts test_scripts/config.test.ts test_scripts/store.test.ts
```
Exit code: 0

Summary:
```
tests 129
suites 25
pass  129
fail  0
cancelled 0
skipped 0
todo  0
duration_ms ~202
```

### Test-bug fixed during development

During the initial run of `slug.test.ts`, one test failed:

```
✖ replaces non-alnum non-hyphen chars with spaces then collapses
  AssertionError: Expected 'it-s-a-test-really' to equal 'its-a-test-really'
```

Diagnosis: **test-bug, not an implementation gap.** The test incorrectly expected `'its-a-test-really'` for the input `"it's a test, really"`. The apostrophe `'` is a non-`[a-z0-9 -]` character; the implementation correctly replaces it with a space, splitting `it's` into `it` + ` ` + `s`, producing `it-s-a-test-really`. The implementation behaviour matches the documented algorithm exactly (step 3: "replace any character outside `[a-z0-9 -]` with a space"). The expected value in the test was updated to `'it-s-a-test-really'` and all tests pass.

## 7. Implementation Gaps

None. All 129 tests pass against the current implementation. No acceptance criterion from the refined request was found to be unmet by the code under test.

## 8. Manual Review Needed

### 1. `package.json` — missing `test` script (shared infra)

The `package.json` `scripts` block currently has no `test` key. To run the full test suite with a single command, add:

```json
"test": "node --import tsx --test test_scripts/*.test.ts"
```

This must be done by a human or the orchestrator — `package.json` is shared infrastructure and this agent does not modify it. Until this is added, run tests manually with:

```
node --import tsx --test test_scripts/slug.test.ts test_scripts/types.test.ts test_scripts/config.test.ts test_scripts/store.test.ts
```

### 2. `tsconfig.json` `rootDir` vs `test_scripts/` mismatch (shared infra)

The existing `Issues - Pending Items.md` already documents this: `rootDir` is `"src"` but `include` contains `"test_scripts/**/*"`. Once test files exist under `test_scripts/`, running `npx tsc --noEmit` will report **TS6059** ("File 'test_scripts/slug.test.ts' is not under 'rootDir' 'src'"). The tests run perfectly through `tsx` (which bypasses `tsc`), but the typecheck script will fail.

Recommended fix (apply to `tsconfig.json`):
- Change `"rootDir": "src"` to `"rootDir": "."`, OR
- Remove `rootDir` entirely (TypeScript will infer it from `include`), OR
- Move all `test_scripts/` content under `src/test_scripts/` (least preferred — conflicts with project convention).

This agent does not modify `tsconfig.json` (shared build infrastructure).

### 3. `node:test` unhandled-rejection behaviour

Node.js `node:test` marks a test as failed only if an exception propagates synchronously or an `async` test rejects. The `unhandledRejection` global event does NOT automatically fail a test. In the current test files this is not an issue (all async work is explicitly awaited), but future test authors should be aware of this and always `await` async calls inside `it()` blocks.

## 9. Commands Run

| # | Command | Exit code |
|---|---|---|
| 1 | `node --import tsx --test test_scripts/slug.test.ts` (initial run, 1 failure) | 1 |
| 2 | `node --import tsx --test test_scripts/slug.test.ts` (after test-bug fix) | 0 |
| 3 | `node --import tsx --test test_scripts/types.test.ts` | 0 |
| 4 | `node --import tsx --test test_scripts/config.test.ts` | 0 |
| 5 | `node --import tsx --test test_scripts/store.test.ts` | 0 |
| 6 | `node --import tsx --test test_scripts/slug.test.ts test_scripts/types.test.ts test_scripts/config.test.ts test_scripts/store.test.ts` (combined run) | 0 |
