# cheerio Extraction Patterns: `<title>` and First `<img src>`

## Overview

This document covers everything needed to write a production TypeScript helper that extracts `title` and `thumbnailUrl` from self-contained HTML5 article files using [cheerio v1.2.0](https://www.npmjs.com/package/cheerio). The extraction runs at publish time; the source file is never rewritten. The project convention is **no fallbacks**: missing or empty metadata must throw an explicit error.

---

## 1. Loading HTML: `cheerio.load` vs `cheerio.loadBuffer`

### The choice

For files read from disk with `fs.readFileSync`, prefer **`cheerio.loadBuffer(buffer)`** over `cheerio.load(fs.readFileSync(path, 'utf8'))`.

| Method | Input | Encoding | When to use |
|---|---|---|---|
| `cheerio.load(string)` | String | Caller must pass correct encoding to `readFileSync` | When encoding is guaranteed UTF-8 and you control the read call |
| `cheerio.loadBuffer(buffer)` | `Buffer` | Runs the HTML5 encoding-sniffing algorithm automatically | **Preferred for files from disk** — handles non-UTF-8 or BOM-prefixed files transparently |

The HTML5 encoding-sniffing algorithm examines `<meta charset>` and `<meta http-equiv="Content-Type">` inside the first 1024 bytes, so it will pick up any encoding declared in `<head>`. All 7 sample articles declare `<meta charset="UTF-8">`, making either method equivalent for them — but `loadBuffer` is the safe default for future articles.

### Does cheerio alter the input?

**No.** Cheerio builds an in-memory parse tree; it never writes anything back to disk. The source `Buffer` you obtained from `fs.readFileSync` is unchanged after `loadBuffer` returns. The file you later copy to `articles/<slug>.html` comes from the original buffer, not from cheerio.

### The third argument (`isDocument`)

By default, `cheerio.load` and `cheerio.loadBuffer` treat the input as a full HTML document (the third argument defaults to `true`). For fully-authored `<!DOCTYPE html>` files this is correct. Do not pass `false` here — that would switch to fragment mode and lose the `<head>/<body>` distinction.

```typescript
import * as cheerio from 'cheerio';
import * as fs from 'fs';

const buffer = fs.readFileSync('/path/to/article.html');
const $ = cheerio.loadBuffer(buffer);
// $ is now a fully-parsed document; <html>, <head>, <body> are present.
```

### Parser engine (parse5 vs htmlparser2)

The default engine for HTML documents is **parse5**, which conforms strictly to the HTML Living Standard. For fully-valid `<!DOCTYPE html>` files this is exactly what you want. Do not pass `{ xml: true }` or `{ xml: { xmlMode: false } }` — that would switch to htmlparser2 and may mangle the DOCTYPE and named HTML entities.

---

## 2. Extracting `<title>`: `.text()`, entity decoding, whitespace

### Basic extraction

```typescript
const rawTitle = $('title').text().trim();
```

### How `.text()` works

- **Concatenates** the decoded text content of all matched elements and all their descendants. For `<title>`, which contains only a text node, this is simply the text node's value.
- **Decodes HTML entities automatically.** Named entities (`&amp;` → `&`, `&mdash;` → `—`, `&rsquo;` → `'`) and numeric entities (`&#8212;` → `—`) are all decoded to their Unicode characters. You do not need a separate entity-decoder.
- **Preserves whitespace.** `.text()` does not trim leading or trailing whitespace. Always apply `.trim()` to normalize.

### Behavior on edge cases

| Scenario | `$('title').text()` result | After `.trim()` |
|---|---|---|
| `<title>My Article</title>` | `"My Article"` | `"My Article"` |
| `<title>  My Article  </title>` | `"  My Article  "` | `"My Article"` |
| `<title>Article &mdash; Author</title>` | `"Article — Author"` | `"Article — Author"` |
| `<title>&amp;amp; Test</title>` | `"&amp; Test"` | `"&amp; Test"` (one decode pass only) |
| `<title></title>` (empty) | `""` | `""` |
| No `<title>` element | `""` | `""` |
| `<title>` outside `<head>` | parse5 moves it into `<head>` per the HTML5 algorithm | treated normally |
| Multiple `<title>` tags | `.text()` on `$('title')` returns the concatenation of **all** title text nodes — use `$('title').first().text()` to be safe |

**Multiple `<title>` tags** — authors rarely do this, but well-formed HTML5 allows only one. parse5 follows the spec's tree construction algorithm: the second `<title>` encountered after `</head>` is treated as body text. `$('title').first()` is therefore the safe selector.

### Project rule: throw on empty title

```typescript
const title = $('title').first().text().trim();
if (title.length === 0) {
  throw new Error(`Article has an empty or missing <title> element`);
}
```

---

## 3. Selecting the First `<img>` in Document Order

### Selector

```typescript
const firstImg = $('img').first();
const src = firstImg.attr('src');
```

### Document-order guarantee

`$('img')` uses cheerio's selector engine (based on css-select, which matches CSSselect semantics). Elements in the returned collection are in **document order** — the same order they appear in the serialized DOM tree from top to bottom. `.first()` therefore reliably returns the first `<img>` encountered during a depth-first traversal of the document, which is identical to the first `<img>` in source order for any well-formed HTML5 file.

### `.attr('src')` behavior

- Returns the **raw attribute value** as a string — no URL normalization, no resolution against a base URL. If `src="https://img.youtube.com/vi/abc/maxresdefault.jpg"`, you get that exact string back.
- If the element has no `src` attribute, `.attr('src')` returns `undefined`.
- Does not look at `srcset`, `data-src`, or any other attribute. This is by design: the project uses `src` only.

### `<img>` inside a `<picture>` element

The `<picture>` element wraps `<source>` elements and a fallback `<img>`. `$('img').first()` selects the `<img>` child, because the selector matches `img` tag names regardless of their parent. A `<picture>` wrapper is transparent to the selector.

```html
<picture>
  <source srcset="hero.avif" type="image/avif">
  <img src="hero.jpg" alt="Hero">
</picture>
```

`$('img').first().attr('src')` → `"hero.jpg"` — correct behavior.

### `<img>` in `<head>`?

Standard HTML5 does not permit `<img>` in `<head>`. If an author accidentally places one there, parse5's tree construction algorithm will move it out of `<head>` (since it is not a valid head element) and parse it as a body element. In practice, `<img>` elements only appear in `<body>` and are never confused with `<link rel="icon">` or `<meta property="og:image">` (those are not `<img>` tags).

### `srcset`, `data-src`, missing `src`

- `srcset` and `data-src` are separate attributes — `.attr('src')` ignores them entirely.
- If the first `<img>` lacks a `src` attribute, `.attr('src')` returns `undefined`.
- Project policy: throw on `undefined` src (no fallback to srcset or data-src).

```typescript
const src = $('img').first().attr('src');
if (src === undefined) {
  throw new Error(`First <img> element has no src attribute`);
}
```

### When there is no `<img>` at all

`$('img').first()` returns an empty cheerio collection (length === 0) when no `<img>` exists. Calling `.attr('src')` on an empty collection returns `undefined`.

This is the case for the **Hermes Agent** sample article, which uses an `<iframe>` for its YouTube embed rather than an `<img>`. The missing-src error will fire for that article.

---

## 4. Complete TypeScript Helper

```typescript
import * as cheerio from 'cheerio';

export interface ArticleMetadata {
  title: string;
  thumbnailUrl: string;
}

/**
 * Extracts article metadata from a raw HTML buffer.
 *
 * Throws ArticleMetadataError if:
 * - <title> is absent or whitespace-only
 * - No <img> element exists in the document
 * - The first <img> element has no src attribute
 *
 * Never returns fallback values.
 */
export function extractArticleMetadata(htmlBuffer: Buffer): ArticleMetadata {
  const $ = cheerio.loadBuffer(htmlBuffer);

  // --- Title extraction ---
  const title = $('title').first().text().trim();
  if (title.length === 0) {
    throw new ArticleMetadataError(
      'EMPTY_TITLE',
      'Article has an empty or missing <title> element. ' +
        'Ensure the HTML file contains a non-empty <title> inside <head>.'
    );
  }

  // --- Thumbnail extraction ---
  const firstImg = $('img').first();
  if (firstImg.length === 0) {
    throw new ArticleMetadataError(
      'NO_IMG',
      'Article contains no <img> element. ' +
        'The first <img> src is used as the catalog thumbnail. ' +
        'If the video is embedded as an <iframe>, add a thumbnail <img> before it.'
    );
  }

  const thumbnailUrl = firstImg.attr('src');
  if (thumbnailUrl === undefined) {
    throw new ArticleMetadataError(
      'IMG_NO_SRC',
      'The first <img> element has no src attribute. ' +
        'Only the src attribute is used; srcset and data-src are not considered.'
    );
  }

  return { title, thumbnailUrl };
}

/** Typed error for metadata extraction failures. */
export class ArticleMetadataError extends Error {
  constructor(
    public readonly code: 'EMPTY_TITLE' | 'NO_IMG' | 'IMG_NO_SRC',
    message: string
  ) {
    super(message);
    this.name = 'ArticleMetadataError';
    // Maintains proper prototype chain in TypeScript/transpiled ES5
    Object.setPrototypeOf(this, ArticleMetadataError.prototype);
  }
}
```

### Usage in the publish CLI

```typescript
import * as fs from 'fs';
import { extractArticleMetadata, ArticleMetadataError } from './extractArticleMetadata';

const buffer = fs.readFileSync(sourcePath);
let metadata: ArticleMetadata;

try {
  metadata = extractArticleMetadata(buffer);
} catch (err) {
  if (err instanceof ArticleMetadataError) {
    console.error(`[publish] Metadata error (${err.code}): ${err.message}`);
    process.exit(1);
  }
  throw err; // re-throw unexpected errors
}

console.log(`Title:     ${metadata.title}`);
console.log(`Thumbnail: ${metadata.thumbnailUrl}`);
```

---

## 5. Expected Output for the 7 Sample Articles

The following table describes what `extractArticleMetadata` will return (or throw) for each sample, based on direct inspection of the source files. The implementation phase should verify these values programmatically.

| Sample file | `title` | `thumbnailUrl` | Throws? |
|---|---|---|---|
| `Deep Dive — _handoff is my new favourite skill (Matt Pocock).html` | `Deep Dive: /handoff is my new favourite skill — Matt Pocock` | `https://img.youtube.com/vi/dtAJ2dOd3ko/maxresdefault.jpg` | No |
| `Deep Dive — Scaling Agents on Kubernetes with ACPX and ACP (Onur Solmaz, OpenClaw).html` | `Deep Dive: Scaling Agents on Kubernetes with ACPX and ACP` | `https://img.youtube.com/vi/VaS2h-dY1-4/maxresdefault.jpg` | No |
| `Deep Dive — Opus 4.7 & OpenAI 5.5 Made Your Prompting Style Obsolete (Nate B Jones).html` | `Deep Dive: Opus 4.7 and OpenAI 5.5 Made Your Prompting Style Obsolete — Nate B Jones` | `https://img.youtube.com/vi/ogTLWGBc3cE/maxresdefault.jpg` | No |
| `Deep Dive — Cooking with Agents in VS Code (Liam Hampton, Microsoft).html` | `Deep Dive: Cooking with Agents in VS Code — Liam Hampton` | `https://img.youtube.com/vi/dyHpnnlkTc8/maxresdefault.jpg` | No |
| `Deep Dive — Anthropic Masterclass Agent Harnesses (Cole Medin).html` | `Deep Dive: Building Agent Harnesses for Large Codebases — Cole Medin` | `https://img.youtube.com/vi/efRIrLXoOVA/maxresdefault.jpg` | No |
| `Deep Dive — The Perfect Zsh Setup For 2026 (Dreams of Code).html` | `Deep Dive: The Perfect Zsh Setup For 2026 — Dreams of Code` | `https://img.youtube.com/vi/1jE7rCvByHg/maxresdefault.jpg` | No |
| `Deep Dive — Hermes Agent Phone Number (David Ondrej).html` | `Deep Dive: I gave my Hermes Agent a phone number (it's crazy)` | — | **Throws `NO_IMG`** — no `<img>` element; video is an `<iframe>` embed |

**Action required for the Hermes Agent article**: The author must add a thumbnail `<img>` element (e.g., a YouTube thumbnail `<img src="https://img.youtube.com/vi/zHE434sBw2U/maxresdefault.jpg" alt="Video thumbnail">`) before the `<iframe>` in the source HTML, or the publish step will fail.

---

## 6. Common Pitfalls

### Pitfall 1: Entity decoding is automatic — do not double-decode

`$('title').text()` always returns decoded Unicode. If you then pass the result through an HTML entity decoder (like `he.decode()`), entities that were legitimately in the original title text (e.g., a title about `&amp;` in code) will be decoded a second time, corrupting the value.

```typescript
// WRONG — double-decodes
import he from 'he';
const title = he.decode($('title').first().text().trim());

// CORRECT — cheerio already decoded
const title = $('title').first().text().trim();
```

### Pitfall 2: Whitespace-only title passes the `.length === 0` check

A title of `"   "` has `.length > 0` but is meaningless. The `.trim()` call before the length check collapses it to `""`, so the empty-title guard fires correctly.

```typescript
// Both of these throw:
// <title></title>       → text() = ""  → trim() = ""  → length 0 → throws
// <title>   </title>    → text() = "   " → trim() = "" → length 0 → throws
```

### Pitfall 3: Confusing `srcset` for `src`

An `<img srcset="small.jpg 480w, big.jpg 1024w">` with no `src` attribute is valid lazy-loading HTML. `$('img').first().attr('src')` returns `undefined` for such an element. The `IMG_NO_SRC` error will fire. The fix is on the article author side: add an explicit `src` attribute as the fallback.

### Pitfall 4: `data-src` lazy-loading patterns

Some articles may use `<img data-src="..." src="">` (with an empty `src`) or `<img data-src="...">` (no `src`) for lazy loading. Both patterns will either throw `IMG_NO_SRC` (no src) or result in an empty string (empty src). Empty string detection should be added:

```typescript
const thumbnailUrl = firstImg.attr('src');
if (!thumbnailUrl) {  // catches undefined AND ""
  throw new ArticleMetadataError(
    'IMG_NO_SRC',
    'The first <img> element has no src attribute (or an empty one). ' +
      'data-src lazy-loading patterns are not supported; use a real src.'
  );
}
```

The helper code in section 4 uses `=== undefined`; for production, use `!thumbnailUrl` to also catch the empty-string case.

### Pitfall 5: Using `htmlparser2` mode for HTML5 documents

Passing `{ xml: { xmlMode: false } }` (htmlparser2 in HTML mode) or `{ xml: true }` (XML mode) changes entity handling and may mangle the DOCTYPE. For fully-valid HTML5 articles, use the **default parse5 engine** (no options passed).

### Pitfall 6: `$('img')` vs `$('body img')`

For articles in the standard structure, `$('img').first()` and `$('body img').first()` are equivalent, because parse5 moves any `<img>` that appears before `</head>` into `<body>` automatically. Either selector is correct; `$('img').first()` is simpler.

### Pitfall 7: `onerror` fallback in the attribute

One sample article (Anthropic / Cole Medin) has `onerror="this.src='...'"` on its `<img>`. This is JavaScript and cheerio does not execute it. `.attr('src')` returns the primary `src` value, not the onerror fallback. This is correct behavior for catalog extraction.

---

## 7. Latest Version and Security Status

| Detail | Value |
|---|---|
| Latest stable version | **1.2.0** (released ~February 2025) |
| Snyk advisory status | No known direct vulnerabilities as of May 2026 |
| Past advisory | npm advisory #1754 (fixed in an earlier release via cheerio-select bump) |
| Maintenance status | Healthy (Snyk), active maintainers, 29.5M weekly downloads |
| Recommended pin | `"cheerio": "^1.2.0"` |

Verify against [Snyk cheerio page](https://security.snyk.io/package/npm/cheerio) before pinning, as per the project's dependency-vetting policy.

---

## 8. Quick Comparison: cheerio vs. Alternatives

For this use case (extracting two fields from a fully-valid HTML5 document, one-shot at publish time), cheerio is the right tool. The one scenario where you would regret it is if you needed byte-for-byte spec-compliant serialization *back* to HTML — cheerio uses parse5's serializer but does not guarantee that `$.html()` round-trips the source bytes identically. For this project that is irrelevant, because you never serialize back through cheerio; the original `Buffer` from `fs.readFileSync` is what goes to disk. If instead you needed to inspect or walk a complex namespaced XML document, or required a live DOM API (`MutationObserver`, Custom Elements, `window`), you would choose linkedom or jsdom. parse5 alone gives you the most spec-accurate parse tree but has no selector engine, so every extraction becomes a manual tree walk. node-html-parser is the fastest option but does not decode named HTML entities by default and has a simplified (non-spec) tree model.

---

## Assumptions and Scope

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| All article files are HTML5 with a single `<title>` in `<head>` | HIGH — confirmed for all 7 samples | If a file has multiple `<title>` tags, `$('title').first()` returns the first one (correct); no change needed |
| The first `<img>` is always a YouTube thumbnail in the hero section | HIGH for current samples | If a future article places a decorative `<img>` before the hero thumbnail, the slug/catalog will use the wrong image — this is an authoring convention the CLI tool should document |
| All files are UTF-8 | HIGH — all 7 samples declare `<meta charset="UTF-8">` | `loadBuffer` handles non-UTF-8 via encoding sniffing; low risk |
| The Hermes Agent article (`zHE434sBw2U`) has no `<img>` at all | CONFIRMED by direct file inspection — no `img` tag matches grep | This file will fail the publish step and must be fixed by the author |
| cheerio 1.2.0 is the latest stable version | HIGH — confirmed via Snyk (May 2026) | If a newer version exists at time of install, the team should vet and adopt it |

### What is OUT of scope

- Extracting other metadata (Open Graph tags, description, keywords).
- Handling `<img>` elements with relative `src` values (all current samples use absolute URLs).
- Writing back to the article HTML (never done; bytes go to disk via the original buffer).
- Encoding detection for non-UTF-8 files beyond what `loadBuffer` provides automatically.

### Clarifying questions for follow-up

1. Should the publish CLI validate that `thumbnailUrl` is an absolute URL (starts with `https://`)? If so, a simple URL constructor check can be added to `extractArticleMetadata`.
2. Is the "first `<img>` in document order" rule sufficient as a long-term convention, or should the article template establish a specific container (e.g., `<div class="hero"> <img ...>`) that the extractor targets with a more specific selector?
3. For the Hermes Agent article fix: should the thumbnail URL be derived from the `<iframe src>` as a convenience (stripping the YouTube video ID to form a `img.youtube.com` URL), or must the author add an explicit `<img>` tag?

---

## References

| # | Source | URL | Information Gathered |
|---|---|---|---|
| 1 | cheerio npm (Snyk) | https://security.snyk.io/package/npm/cheerio | Latest version 1.2.0, no known direct vulnerabilities, maintenance healthy |
| 2 | cheerio official docs — Loading | https://cheerio.js.org/docs/basics/loading | `loadBuffer` API, encoding-sniffing, `load` vs `loadBuffer` distinction |
| 3 | cheerio official docs — Configuring | https://cheerio.js.org/docs/advanced/configuring-cheerio/ | parse5 default for HTML, htmlparser2 for XML, `xml` option details, fragment mode |
| 4 | cheerio official intro | https://cheerio.js.org/docs/intro | `load`, selector API, traversal basics |
| 5 | Context7 cheerio docs | https://context7.com/cheeriojs/cheerio/llms.txt | `attr()` get/set semantics, `extract()` API, `text()` usage |
| 6 | GitHub cheerio issue #52 | https://github.com/cheeriojs/cheerio/issues/52 | `.text()` decodes HTML entities — confirmed behavior |
| 7 | GitHub cheerio issue #466 | https://github.com/cheeriojs/cheerio/issues/467 | `decodeEntities` applies to serialization (`.html()`), not to `.text()` reads |
| 8 | Snyk cheerio vulnerability history | https://security.snyk.io/package/npm/cheerio/versions | npm advisory #1754 fixed via cheerio-select bump |
| 9 | ZenRows cheerio web scraping guide | https://www.zenrows.com/blog/web-scraping-cheerio | Document-order guarantee for `$('img').first()`, practical selector patterns |
| 10 | npm-compare cheerio vs parse5 | https://npm-compare.com/cheerio,jsdom,node-html-parser,parse5 | Library comparison trade-offs |
| 11 | ScrapeOps NodeJS parsing libraries | https://scrapeops.io/nodejs-web-scraping-playbook/best-nodejs-html-parsing-libraries/ | Cheerio vs parse5 vs linkedom vs node-html-parser decision criteria |
| 12 | WebScraping.AI encoding FAQ | https://webscraping.ai/faq/cheerio/how-do-you-handle-encoding-issues-with-cheerio | `loadBuffer` recommended for files from disk |
| 13 | cheerio GitHub release blog (v1) | https://github.com/cheeriojs/cheerio/blob/main/website/src/content/blog/2024-08-07-version-1.md | v1.0 changes: htmlparser2 options moved under `xml` key |

### Recommended for deep reading

- [cheerio Loading docs](https://cheerio.js.org/docs/basics/loading) — authoritative on `loadBuffer` vs `load` vs streams.
- [cheerio Configuring docs](https://cheerio.js.org/docs/advanced/configuring-cheerio/) — authoritative on parse5 vs htmlparser2 mode and the `xml` option.
- [Snyk cheerio page](https://security.snyk.io/package/npm/cheerio) — check before pinning per project dependency-vetting policy.
