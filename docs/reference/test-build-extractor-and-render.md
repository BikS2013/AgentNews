---
status: completed
mode: write-and-run
scope_slug: extractor-and-catalog-html-renderer
language: TypeScript
framework: node:test (Node.js built-in)
test_command_full: npx tsx --test test_scripts/test-extractor.ts && npx tsx --test test_scripts/test-catalog-renderer.ts
test_command_scope: npx tsx --test test_scripts/test-extractor.ts && npx tsx --test test_scripts/test-catalog-renderer.ts
test_dir: test_scripts
target_path: /Users/giorgosmarinos/aiwork/coding-platform/agent-news
test_files_owned:
  - test_scripts/test-extractor.ts
  - test_scripts/test-catalog-renderer.ts
tests_added: 55
tests_updated: 0
tests_run: 55
tests_passed: 55
tests_failed: 0
implementation_gaps: 0
built_at: 2026-05-22T17:22:59Z
last_built_commit: null
---

# Test Build — Article Extractor + Catalog HTML Renderer

## 1. Summary

Status: **completed**. Framework detected as `node:test` (Node.js 25.9.0 built-in; zero new runtime dependencies required). Two new test files were written covering `extractArticleMetadata` across all 7 real sample files and synthetic error-path HTML, plus `renderCatalogHtml` across structural invariants, empty-catalog behavior, newest-first sorting, all five HTML metacharacter escaping scenarios, link structure, and date formatting. All 55 tests pass with zero failures and zero implementation gaps.

## 2. Scope Resolved

### Source files in scope

- **`src/extractor/extract.ts`**
  - `extractArticleMetadata(htmlBuffer: Buffer): ArticleMetadata`
  - `ArticleMetadata` type (title, thumbnailUrl)

- **`src/extractor/errors.ts`**
  - `ArticleMetadataError` class (extends `Error`, fields: `code`, `name`)
  - `ArticleMetadataErrorCode` type (`'EMPTY_TITLE' | 'IMG_NO_SRC'`)

- **`src/server/render/catalog.ts`**
  - `renderCatalogHtml(entries: readonly CatalogEntry[]): string`
  - `escapeHtml(input: string): string` (module-private helper, tested indirectly)
  - `formatPublishedAt(iso: string): string` (module-private helper, tested indirectly)

### Indirect dependency read (not modified)

- **`src/catalog/types.ts`** — `CatalogEntry` and `CatalogFile` interfaces imported for type annotations in `test-catalog-renderer.ts`.

## 3. Existing Coverage

No existing test files covered any of the in-scope symbols prior to this build. The `test_scripts/` directory contained only a `.gitkeep` placeholder file. A separate `test_scripts/verify-byte-identity.ts` exists (referenced in `package.json` as the `verify` script) but was not inspected — it is out of scope.

| Symbol | Existing test files |
|---|---|
| `extractArticleMetadata` | None |
| `ArticleMetadataError` | None |
| `renderCatalogHtml` | None |

## 4. Plan

| # | target_symbol | category | test_file | test_name | intent |
|---|---|---|---|---|---|
| 1 | `extractArticleMetadata` | unit | test-extractor.ts | extracts correct title from each of 7 samples | Proves title extraction returns the verbatim `<title>` text for every real sample |
| 2 | `extractArticleMetadata` | unit | test-extractor.ts | title is non-empty for each sample | Proves no sample silently produces an empty string |
| 3 | `extractArticleMetadata` | unit | test-extractor.ts | returns thumbnailUrl: null for Hermes Agent | Proves the no-`<img>` case returns null, not an error |
| 4 | `extractArticleMetadata` | unit | test-extractor.ts | extracts YouTube thumbnail URL for 6 remaining samples | Proves correct src extraction for every sample that has an `<img>` |
| 5 | `extractArticleMetadata` | error_path | test-extractor.ts | throws EMPTY_TITLE when `<title>` is missing | Proves missing `<title>` raises `ArticleMetadataError` with correct code |
| 6 | `extractArticleMetadata` | error_path | test-extractor.ts | throws EMPTY_TITLE when `<title>` is whitespace-only | Proves whitespace `<title>` is treated as empty after trim |
| 7 | `extractArticleMetadata` | error_path | test-extractor.ts | throws IMG_NO_SRC when `<img>` has no src | Proves presence of `<img>` without `src` raises `ArticleMetadataError` |
| 8 | `extractArticleMetadata` | error_path | test-extractor.ts | throws IMG_NO_SRC when `<img>` has empty src | Proves `src=""` is treated the same as missing `src` |
| 9 | `extractArticleMetadata` | unit | test-extractor.ts | returns null (no error) when no `<img>` exists | Confirms the no-`<img>` path is silent (not an error) |
| 10 | `ArticleMetadataError` | unit | test-extractor.ts | has correct name property | Verifies prototype chain is maintained under transpilation |
| 11 | `ArticleMetadataError` | unit | test-extractor.ts | is instanceof Error | Verifies the base-class relationship |
| 12 | `extractArticleMetadata` | unit | test-extractor.ts | trims whitespace from title | Ensures leading/trailing whitespace is stripped |
| 13 | `extractArticleMetadata` | unit | test-extractor.ts | uses first `<img>` in document order | Ensures second `<img>` is not mistakenly used |
| 14 | `extractArticleMetadata` | unit | test-extractor.ts | returns src as-is (no normalization) | Ensures no URL rewriting occurs |
| 15 | `renderCatalogHtml` | unit | test-catalog-renderer.ts | output starts with `<!DOCTYPE html>` | Verifies the document type declaration |
| 16 | `renderCatalogHtml` | unit | test-catalog-renderer.ts | contains `<title>Article Catalog</title>` | Verifies the page title per acceptance criteria |
| 17 | `renderCatalogHtml` | unit | test-catalog-renderer.ts | contains `<html lang="en">` | Verifies language attribute |
| 18 | `renderCatalogHtml` | unit | test-catalog-renderer.ts | contains `<meta charset="utf-8">` | Verifies charset declaration |
| 19 | `renderCatalogHtml` | unit | test-catalog-renderer.ts | renders "No articles" when empty | Verifies empty-catalog message |
| 20 | `renderCatalogHtml` | unit | test-catalog-renderer.ts | reports "0 articles published" for empty | Verifies header count for empty catalog |
| 21 | `renderCatalogHtml` | unit | test-catalog-renderer.ts | no `<article>` cards when empty | Ensures no ghost card elements |
| 22 | `renderCatalogHtml` | unit | test-catalog-renderer.ts | renders newest article first (2-entry) | Proves newest-first sort for 2 entries in wrong input order |
| 23 | `renderCatalogHtml` | unit | test-catalog-renderer.ts | renders 3 entries in descending date order | Proves sort order for 3 entries |
| 24 | `renderCatalogHtml` | unit | test-catalog-renderer.ts | does not mutate the input array | Proves sort uses a copy (`slice()`) not in-place sort |
| 25–29 | `renderCatalogHtml` / `escapeHtml` | unit | test-catalog-renderer.ts | escapes `<`, `>`, `&`, `"`, `'` individually | Proves each metacharacter is escaped correctly |
| 30 | `renderCatalogHtml` / `escapeHtml` | unit | test-catalog-renderer.ts | escapes `&` in thumbnailUrl attribute | Verifies URL query string ampersands are escaped |
| 31 | `renderCatalogHtml` / `escapeHtml` | unit | test-catalog-renderer.ts | escapes `<>` in slug href | Verifies pathological slug is escaped in href |
| 32 | `renderCatalogHtml` / `escapeHtml` | unit | test-catalog-renderer.ts | all five metacharacters in combined title | Single test hitting all five escape replacements |
| 33 | `renderCatalogHtml` | unit | test-catalog-renderer.ts | renders `<a href="/a/<slug>">` | Verifies the link path pattern |
| 34 | `renderCatalogHtml` | unit | test-catalog-renderer.ts | separate links for each of 3 entries | Verifies all entries generate distinct links |
| 35 | `renderCatalogHtml` | unit | test-catalog-renderer.ts | "1 article published" (singular) | Verifies singular form of count label |
| 36 | `renderCatalogHtml` | unit | test-catalog-renderer.ts | "2 articles published" (plural) | Verifies plural form of count label |
| 37 | `renderCatalogHtml` / `formatPublishedAt` | unit | test-catalog-renderer.ts | YYYY-MM-DD UTC format | Verifies date format displayed to readers |
| 38 | `renderCatalogHtml` / `formatPublishedAt` | unit | test-catalog-renderer.ts | zero-padded month and day | Verifies `03-05` not `3-5` |

## 5. Files Owned

| File | Reason |
|---|---|
| `test_scripts/test-extractor.ts` | New — no prior extractor tests existed |
| `test_scripts/test-catalog-renderer.ts` | New — no prior renderer tests existed |

## 6. Test Run Results

### test-extractor.ts

```
▶ extractArticleMetadata — real sample corpus (7 files)
  ✔ extracts correct title from "Deep Dive — Anthropic Masterclass Agent Harnesses (Cole Medin).html" (13.5ms)
  ✔ title is non-empty for "Deep Dive — Anthropic Masterclass Agent Harnesses (Cole Medin).html" (4.4ms)
  ✔ extracts correct YouTube thumbnail URL from "Deep Dive — Anthropic Masterclass Agent Harnesses (Cole Medin).html" (3.1ms)
  ✔ extracts correct title from "Deep Dive — _handoff is my new favourite skill (Matt Pocock).html" (1.3ms)
  ✔ title is non-empty for "Deep Dive — _handoff is my new favourite skill (Matt Pocock).html" (1.2ms)
  ✔ extracts correct YouTube thumbnail URL from "Deep Dive — _handoff is my new favourite skill (Matt Pocock).html" (1.3ms)
  ✔ extracts correct title from "Deep Dive — The Perfect Zsh Setup For 2026 (Dreams of Code).html" (2.2ms)
  ✔ title is non-empty for "Deep Dive — The Perfect Zsh Setup For 2026 (Dreams of Code).html" (2.4ms)
  ✔ extracts correct YouTube thumbnail URL from "Deep Dive — The Perfect Zsh Setup For 2026 (Dreams of Code).html" (1.8ms)
  ✔ extracts correct title from "Deep Dive — Hermes Agent Phone Number (David Ondrej).html" (3.2ms)
  ✔ title is non-empty for "Deep Dive — Hermes Agent Phone Number (David Ondrej).html" (2.9ms)
  ✔ returns thumbnailUrl: null (no <img>) for "Deep Dive — Hermes Agent Phone Number (David Ondrej).html" (1.9ms)
  ✔ extracts correct title from "Deep Dive — Opus 4.7 & OpenAI 5.5 Made Your Prompting Style Obsolete (Nate B Jones).html" (1.9ms)
  ✔ title is non-empty for "Deep Dive — Opus 4.7 & OpenAI 5.5 Made Your Prompting Style Obsolete (Nate B Jones).html" (1.3ms)
  ✔ extracts correct YouTube thumbnail URL from "Deep Dive — Opus 4.7 & OpenAI 5.5 Made Your Prompting Style Obsolete (Nate B Jones).html" (3.4ms)
  ✔ extracts correct title from "Deep Dive — Cooking with Agents in VS Code (Liam Hampton, Microsoft).html" (1.1ms)
  ✔ title is non-empty for "Deep Dive — Cooking with Agents in VS Code (Liam Hampton, Microsoft).html" (1.0ms)
  ✔ extracts correct YouTube thumbnail URL from "Deep Dive — Cooking with Agents in VS Code (Liam Hampton, Microsoft).html" (1.0ms)
  ✔ extracts correct title from "Deep Dive — Scaling Agents on Kubernetes with ACPX and ACP (Onur Solmaz, OpenClaw).html" (0.9ms)
  ✔ title is non-empty for "Deep Dive — Scaling Agents on Kubernetes with ACPX and ACP (Onur Solmaz, OpenClaw).html" (0.8ms)
  ✔ extracts correct YouTube thumbnail URL from "Deep Dive — Scaling Agents on Kubernetes with ACPX and ACP (Onur Solmaz, OpenClaw).html" (1.0ms)
✔ extractArticleMetadata — real sample corpus (7 files) (52.3ms)
▶ extractArticleMetadata — error paths
  ✔ throws ArticleMetadataError with code EMPTY_TITLE when <title> is missing (0.5ms)
  ✔ throws ArticleMetadataError with code EMPTY_TITLE when <title> is whitespace-only (0.3ms)
  ✔ throws ArticleMetadataError with code IMG_NO_SRC when <img> has no src attribute (0.1ms)
  ✔ throws ArticleMetadataError with code IMG_NO_SRC when <img> has empty src attribute (0.1ms)
  ✔ returns thumbnailUrl: null (no error) when HTML has a title but no <img> at all (0.1ms)
  ✔ ArticleMetadataError has correct name property (0.1ms)
  ✔ ArticleMetadataError is instanceof Error (0.1ms)
✔ extractArticleMetadata — error paths (1.4ms)
▶ extractArticleMetadata — edge cases
  ✔ trims surrounding whitespace from <title> (0.1ms)
  ✔ uses first <img> in document order, not a later one (0.1ms)
  ✔ returns the src value as-is (no normalization) (0.1ms)
✔ extractArticleMetadata — edge cases (0.2ms)
tests 31 | pass 31 | fail 0 | duration 278ms
```

### test-catalog-renderer.ts

```
▶ renderCatalogHtml — structural invariants
  ✔ output starts with <!DOCTYPE html> (0.4ms)
  ✔ output contains <title>Article Catalog</title> (0.04ms)
  ✔ output contains <html lang="en"> (0.03ms)
  ✔ output contains <meta charset="utf-8"> (0.03ms)
✔ renderCatalogHtml — structural invariants (0.9ms)
▶ renderCatalogHtml — empty entries
  ✔ renders "No articles" message when entries array is empty (0.04ms)
  ✔ reports 0 articles published in the header (0.03ms)
  ✔ does not render any <article> cards when entries is empty (0.03ms)
✔ renderCatalogHtml — empty entries (0.2ms)
▶ renderCatalogHtml — newest-first ordering
  ✔ renders newest article first (earlier ISO timestamp appears later in output) (0.8ms)
  ✔ renders three entries in descending date order (0.1ms)
  ✔ does not mutate the input array (0.1ms)
✔ renderCatalogHtml — newest-first ordering (1.0ms)
▶ renderCatalogHtml — HTML special character escaping
  ✔ escapes < in title (0.1ms)
  ✔ escapes > in title (0.04ms)
  ✔ escapes & in title (0.04ms)
  ✔ escapes " in title (0.03ms)
  ✔ escapes ' in title (0.03ms)
  ✔ escapes & in thumbnailUrl attribute (0.03ms)
  ✔ escapes < and > in slug used in href (0.03ms)
  ✔ all five metacharacters are escaped in a combined title (0.03ms)
✔ renderCatalogHtml — HTML special character escaping (0.4ms)
▶ renderCatalogHtml — article link structure
  ✔ renders <a href="/a/<slug>"> link for each entry (0.03ms)
  ✔ renders separate links for each entry (0.03ms)
  ✔ renders "1 article published" (singular) for a single entry (0.03ms)
  ✔ renders "<n> articles published" (plural) for multiple entries (0.5ms)
✔ renderCatalogHtml — article link structure (0.6ms)
▶ renderCatalogHtml — publication date display
  ✔ displays date in YYYY-MM-DD UTC format (0.04ms)
  ✔ correctly formats a date with single-digit month and day (0.03ms)
✔ renderCatalogHtml — publication date display (0.1ms)
tests 24 | pass 24 | fail 0 | duration 121ms
```

## 7. Implementation Gaps

None. All tests pass; no acceptance criterion from the refined request was found to be unmet by the current implementation.

## 8. Manual Review Needed

### npm `test` script not set

`package.json` currently has no `test` script entry. To enable `npm test` / `pnpm test` for the scope-owned test files, add the following to the `"scripts"` section of `package.json`:

```json
"test": "tsx --test test_scripts/test-extractor.ts test_scripts/test-catalog-renderer.ts"
```

This agent did not modify `package.json` because that file is shared infrastructure (other test-builder agents may be adding their own test scripts concurrently). A human or integration step should merge all test script contributions into a single `test` command (or use a glob: `"test": "tsx --test 'test_scripts/test-*.ts'"`).

### Unhandled-rejection configuration

The project has no Jest/Vitest config to enforce fail-on-unhandled-rejection. `node:test` in Node 25 does propagate unhandled rejections to test failures by default, so this is not a blocking concern for the current test files. No shared config file needs modification.

## 9. Commands Run

| # | Command | Exit code |
|---|---|---|
| 1 | `node --version` | 0 |
| 2 | `npx tsx --version` | 0 |
| 3 | `ls -la samples/` | 0 |
| 4 | `npx tsx --test test_scripts/test-extractor.ts` | 0 |
| 5 | `npx tsx --test test_scripts/test-catalog-renderer.ts` | 0 |
