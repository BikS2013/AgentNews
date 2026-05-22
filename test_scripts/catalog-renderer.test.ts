/**
 * Unit tests for src/server/render/catalog.ts
 *
 * Uses Node.js built-in test runner (node:test) — no additional dependencies.
 * Run with:  npx tsx --test test_scripts/test-catalog-renderer.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderCatalogHtml } from '../src/server/render/catalog.js';
import type { CatalogEntry } from '../src/catalog/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal but valid CatalogEntry for testing. */
function makeEntry(overrides: Partial<CatalogEntry> & { slug: string; title: string; publishedAt: string }): CatalogEntry {
  return {
    sourcePath: 'samples/article.html',
    articlePath: `articles/${overrides.slug}.html`,
    thumbnailUrl: 'https://img.youtube.com/vi/PLACEHOLDER/maxresdefault.jpg',
    thumbnailSource: 'html',
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: structural invariants
// ---------------------------------------------------------------------------

describe('renderCatalogHtml — structural invariants', () => {
  it('output starts with <!DOCTYPE html>', () => {
    const html = renderCatalogHtml([]);
    assert.ok(
      html.trimStart().startsWith('<!DOCTYPE html>'),
      'Expected output to start with <!DOCTYPE html>',
    );
  });

  it('output contains <title>Article Catalog</title>', () => {
    const html = renderCatalogHtml([]);
    assert.ok(
      html.includes('<title>Article Catalog</title>'),
      'Expected <title>Article Catalog</title> in output',
    );
  });

  it('output contains <html lang="en">', () => {
    const html = renderCatalogHtml([]);
    assert.ok(
      html.includes('<html lang="en">'),
      'Expected <html lang="en"> in output',
    );
  });

  it('output contains <meta charset="utf-8">', () => {
    const html = renderCatalogHtml([]);
    assert.ok(
      html.includes('<meta charset="utf-8">'),
      'Expected charset meta tag in output',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: empty catalog
// ---------------------------------------------------------------------------

describe('renderCatalogHtml — empty entries', () => {
  it('renders "No articles" message when entries array is empty', () => {
    const html = renderCatalogHtml([]);
    assert.ok(
      html.includes('No articles'),
      'Expected "No articles" message when catalog is empty',
    );
  });

  it('reports 0 articles published in the header', () => {
    const html = renderCatalogHtml([]);
    assert.ok(
      html.includes('0 articles published'),
      'Expected "0 articles published" in header for empty catalog',
    );
  });

  it('does not render any <article> cards when entries is empty', () => {
    const html = renderCatalogHtml([]);
    assert.ok(
      !html.includes('<article'),
      'Expected no <article> cards for empty catalog',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: newest-first sort
// ---------------------------------------------------------------------------

describe('renderCatalogHtml — newest-first ordering', () => {
  it('renders newest article first (earlier ISO timestamp appears later in output)', () => {
    const older = makeEntry({
      slug: 'older-article',
      title: 'Older Article',
      publishedAt: '2024-01-01T00:00:00Z',
    });
    const newer = makeEntry({
      slug: 'newer-article',
      title: 'Newer Article',
      publishedAt: '2025-06-15T12:00:00Z',
    });
    // Pass in oldest-first order; renderer must reverse.
    const html = renderCatalogHtml([older, newer]);
    const newerPos = html.indexOf('newer-article');
    const olderPos = html.indexOf('older-article');
    assert.ok(
      newerPos !== -1 && olderPos !== -1,
      'Both slugs must appear in the output',
    );
    assert.ok(
      newerPos < olderPos,
      `Newer article (pos ${newerPos}) must appear before older article (pos ${olderPos}) in the HTML`,
    );
  });

  it('renders three entries in descending date order', () => {
    const entries = [
      makeEntry({ slug: 'early', title: 'Early', publishedAt: '2023-03-01T00:00:00Z' }),
      makeEntry({ slug: 'middle', title: 'Middle', publishedAt: '2024-07-15T00:00:00Z' }),
      makeEntry({ slug: 'recent', title: 'Recent', publishedAt: '2025-12-31T23:59:59Z' }),
    ];
    // Supply in arbitrary order (early, middle, recent).
    const html = renderCatalogHtml(entries);
    const posRecent = html.indexOf('recent');
    const posMiddle = html.indexOf('middle');
    const posEarly = html.indexOf('early');
    assert.ok(posRecent < posMiddle, 'recent must come before middle');
    assert.ok(posMiddle < posEarly, 'middle must come before early');
  });

  it('does not mutate the input array', () => {
    const entries = [
      makeEntry({ slug: 'first', title: 'First', publishedAt: '2025-01-01T00:00:00Z' }),
      makeEntry({ slug: 'second', title: 'Second', publishedAt: '2024-01-01T00:00:00Z' }),
    ];
    const originalFirst = entries[0]!.slug;
    renderCatalogHtml(entries);
    assert.equal(entries[0]!.slug, originalFirst, 'Input array must not be mutated by sort');
  });
});

// ---------------------------------------------------------------------------
// Tests: HTML escaping
// ---------------------------------------------------------------------------

describe('renderCatalogHtml — HTML special character escaping', () => {
  it('escapes < in title', () => {
    const entry = makeEntry({
      slug: 'test-lt',
      title: 'A <script> Tag',
      publishedAt: '2025-01-01T00:00:00Z',
    });
    const html = renderCatalogHtml([entry]);
    // The literal < must NOT appear in the rendered title region.
    // It should be encoded as &lt;
    assert.ok(
      html.includes('&lt;script&gt;'),
      'Expected < to be escaped as &lt; in title',
    );
    // Ensure the unescaped angle bracket is not present outside the DOCTYPE/html/head tags.
    // We verify the dangerous pattern is absent anywhere near the title.
    assert.ok(
      !html.includes('<script>'),
      'Unescaped <script> must not appear in output',
    );
  });

  it('escapes > in title', () => {
    const entry = makeEntry({
      slug: 'test-gt',
      title: 'A > B',
      publishedAt: '2025-01-01T00:00:00Z',
    });
    const html = renderCatalogHtml([entry]);
    assert.ok(html.includes('A &gt; B'), 'Expected > to be escaped as &gt;');
  });

  it('escapes & in title', () => {
    const entry = makeEntry({
      slug: 'test-amp',
      title: 'Fish & Chips',
      publishedAt: '2025-01-01T00:00:00Z',
    });
    const html = renderCatalogHtml([entry]);
    assert.ok(
      html.includes('Fish &amp; Chips'),
      'Expected & to be escaped as &amp; in title',
    );
  });

  it('escapes " in title', () => {
    const entry = makeEntry({
      slug: 'test-dquote',
      title: 'Say "Hello"',
      publishedAt: '2025-01-01T00:00:00Z',
    });
    const html = renderCatalogHtml([entry]);
    assert.ok(
      html.includes('Say &quot;Hello&quot;'),
      'Expected " to be escaped as &quot; in title',
    );
  });

  it('escapes \' in title', () => {
    const entry = makeEntry({
      slug: 'test-squote',
      title: "It's alive",
      publishedAt: '2025-01-01T00:00:00Z',
    });
    const html = renderCatalogHtml([entry]);
    assert.ok(
      html.includes('It&#39;s alive'),
      "Expected ' to be escaped as &#39; in title",
    );
  });

  it('escapes & in thumbnailUrl attribute', () => {
    const entry = makeEntry({
      slug: 'test-url-amp',
      title: 'URL Amp Test',
      publishedAt: '2025-01-01T00:00:00Z',
      thumbnailUrl: 'https://example.com/image?a=1&b=2',
    });
    const html = renderCatalogHtml([entry]);
    assert.ok(
      html.includes('?a=1&amp;b=2'),
      'Expected & in thumbnailUrl to be escaped as &amp;',
    );
    assert.ok(
      !html.includes('?a=1&b=2'),
      'Unescaped & must not appear in thumbnailUrl attribute',
    );
  });

  it('escapes < and > in slug used in href', () => {
    // A slug containing < or > would be pathological but must still be escaped.
    const entry = makeEntry({
      slug: 'safe-slug',
      title: 'Safe',
      publishedAt: '2025-01-01T00:00:00Z',
    });
    // Override slug directly to bypass makeEntry validation convenience.
    const malicious = { ...entry, slug: 'a<b>c' };
    const html = renderCatalogHtml([malicious]);
    assert.ok(
      html.includes('href="/a/a&lt;b&gt;c"'),
      'Slug with < > must be escaped in href attribute',
    );
  });

  it('all five metacharacters are escaped in a combined title', () => {
    const entry = makeEntry({
      slug: 'combined-escape',
      title: `<script> & "injection" attempt '`,
      publishedAt: '2025-01-01T00:00:00Z',
    });
    const html = renderCatalogHtml([entry]);
    assert.ok(html.includes('&lt;script&gt;'), '< and > escaped');
    assert.ok(html.includes('&amp;'), '& escaped');
    assert.ok(html.includes('&quot;injection&quot;'), '" escaped');
    assert.ok(html.includes('attempt &#39;'), "' escaped");
  });
});

// ---------------------------------------------------------------------------
// Tests: article link structure
// ---------------------------------------------------------------------------

describe('renderCatalogHtml — article link structure', () => {
  it('renders <a href="/a/<slug>"> link for each entry', () => {
    const entry = makeEntry({
      slug: 'my-article',
      title: 'My Article',
      publishedAt: '2025-01-01T00:00:00Z',
    });
    const html = renderCatalogHtml([entry]);
    assert.ok(
      html.includes('href="/a/my-article"'),
      'Expected href="/a/my-article" in output',
    );
  });

  it('renders separate links for each entry', () => {
    const entries = [
      makeEntry({ slug: 'article-one', title: 'Article One', publishedAt: '2025-06-01T00:00:00Z' }),
      makeEntry({ slug: 'article-two', title: 'Article Two', publishedAt: '2025-05-01T00:00:00Z' }),
      makeEntry({ slug: 'article-three', title: 'Article Three', publishedAt: '2025-04-01T00:00:00Z' }),
    ];
    const html = renderCatalogHtml(entries);
    assert.ok(html.includes('href="/a/article-one"'), 'Expected link for article-one');
    assert.ok(html.includes('href="/a/article-two"'), 'Expected link for article-two');
    assert.ok(html.includes('href="/a/article-three"'), 'Expected link for article-three');
  });

  it('renders "1 article published" (singular) for a single entry', () => {
    const entry = makeEntry({
      slug: 'solo-article',
      title: 'Solo Article',
      publishedAt: '2025-01-01T00:00:00Z',
    });
    const html = renderCatalogHtml([entry]);
    assert.ok(
      html.includes('1 article published'),
      'Expected "1 article published" (not "1 articles published") for single entry',
    );
  });

  it('renders "<n> articles published" (plural) for multiple entries', () => {
    const entries = [
      makeEntry({ slug: 'art-a', title: 'Art A', publishedAt: '2025-06-01T00:00:00Z' }),
      makeEntry({ slug: 'art-b', title: 'Art B', publishedAt: '2025-05-01T00:00:00Z' }),
    ];
    const html = renderCatalogHtml(entries);
    assert.ok(
      html.includes('2 articles published'),
      'Expected "2 articles published" for two entries',
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: publication date formatting
// ---------------------------------------------------------------------------

describe('renderCatalogHtml — publication date display', () => {
  it('displays date in YYYY-MM-DD UTC format', () => {
    const entry = makeEntry({
      slug: 'dated-article',
      title: 'Dated Article',
      publishedAt: '2025-06-15T14:30:00Z',
    });
    const html = renderCatalogHtml([entry]);
    assert.ok(
      html.includes('2025-06-15 UTC'),
      'Expected formatted date "2025-06-15 UTC" in output',
    );
  });

  it('correctly formats a date with single-digit month and day', () => {
    const entry = makeEntry({
      slug: 'padded-date',
      title: 'Padded Date',
      publishedAt: '2025-03-05T08:00:00Z',
    });
    const html = renderCatalogHtml([entry]);
    assert.ok(
      html.includes('2025-03-05 UTC'),
      'Expected zero-padded "2025-03-05 UTC" in output',
    );
  });
});
