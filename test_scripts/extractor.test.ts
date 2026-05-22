/**
 * Unit tests for src/extractor/extract.ts and src/extractor/errors.ts
 *
 * Uses Node.js built-in test runner (node:test) — no additional dependencies.
 * Run with:  npx tsx --test test_scripts/test-extractor.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { extractArticleMetadata } from '../src/extractor/extract.js';
import { ArticleMetadataError } from '../src/extractor/errors.js';

// Resolve the project root relative to this test file.
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const SAMPLES_DIR = join(PROJECT_ROOT, 'samples');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadSample(filename: string): Buffer {
  return readFileSync(join(SAMPLES_DIR, filename));
}

// ---------------------------------------------------------------------------
// Fixture table — all 7 samples
// ---------------------------------------------------------------------------

interface SampleFixture {
  filename: string;
  expectedTitle: string;
  /** null when the article contains no <img> at all */
  expectedThumbnailUrl: string | null;
}

const SAMPLE_FIXTURES: SampleFixture[] = [
  {
    filename:
      'Deep Dive — Anthropic Masterclass Agent Harnesses (Cole Medin).html',
    expectedTitle:
      'Deep Dive: Building Agent Harnesses for Large Codebases — Cole Medin',
    expectedThumbnailUrl:
      'https://img.youtube.com/vi/efRIrLXoOVA/maxresdefault.jpg',
  },
  {
    filename:
      'Deep Dive — _handoff is my new favourite skill (Matt Pocock).html',
    expectedTitle:
      'Deep Dive: /handoff is my new favourite skill — Matt Pocock',
    expectedThumbnailUrl:
      'https://img.youtube.com/vi/dtAJ2dOd3ko/maxresdefault.jpg',
  },
  {
    filename:
      'Deep Dive — The Perfect Zsh Setup For 2026 (Dreams of Code).html',
    expectedTitle:
      'Deep Dive: The Perfect Zsh Setup For 2026 — Dreams of Code',
    expectedThumbnailUrl:
      'https://img.youtube.com/vi/1jE7rCvByHg/maxresdefault.jpg',
  },
  {
    // This sample has NO <img> — extractor must return thumbnailUrl: null.
    filename:
      'Deep Dive — Hermes Agent Phone Number (David Ondrej).html',
    expectedTitle:
      "Deep Dive: I gave my Hermes Agent a phone number (it's crazy)",
    expectedThumbnailUrl: null,
  },
  {
    filename:
      'Deep Dive — Opus 4.7 & OpenAI 5.5 Made Your Prompting Style Obsolete (Nate B Jones).html',
    expectedTitle:
      'Deep Dive: Opus 4.7 and OpenAI 5.5 Made Your Prompting Style Obsolete — Nate B Jones',
    expectedThumbnailUrl:
      'https://img.youtube.com/vi/ogTLWGBc3cE/maxresdefault.jpg',
  },
  {
    filename:
      'Deep Dive — Cooking with Agents in VS Code (Liam Hampton, Microsoft).html',
    expectedTitle:
      'Deep Dive: Cooking with Agents in VS Code — Liam Hampton',
    expectedThumbnailUrl:
      'https://img.youtube.com/vi/dyHpnnlkTc8/maxresdefault.jpg',
  },
  {
    filename:
      'Deep Dive — Scaling Agents on Kubernetes with ACPX and ACP (Onur Solmaz, OpenClaw).html',
    expectedTitle:
      'Deep Dive: Scaling Agents on Kubernetes with ACPX and ACP',
    expectedThumbnailUrl:
      'https://img.youtube.com/vi/VaS2h-dY1-4/maxresdefault.jpg',
  },
];

// ---------------------------------------------------------------------------
// Tests: real sample corpus
// ---------------------------------------------------------------------------

describe('extractArticleMetadata — real sample corpus (7 files)', () => {
  for (const fixture of SAMPLE_FIXTURES) {
    it(`extracts correct title from "${fixture.filename}"`, () => {
      const buffer = loadSample(fixture.filename);
      const metadata = extractArticleMetadata(buffer);
      assert.equal(
        metadata.title,
        fixture.expectedTitle,
        `Title mismatch for ${fixture.filename}`,
      );
    });

    it(`title is non-empty for "${fixture.filename}"`, () => {
      const buffer = loadSample(fixture.filename);
      const metadata = extractArticleMetadata(buffer);
      assert.ok(
        metadata.title.length > 0,
        `Expected non-empty title for ${fixture.filename}`,
      );
    });

    if (fixture.expectedThumbnailUrl === null) {
      it(`returns thumbnailUrl: null (no <img>) for "${fixture.filename}"`, () => {
        const buffer = loadSample(fixture.filename);
        const metadata = extractArticleMetadata(buffer);
        assert.equal(
          metadata.thumbnailUrl,
          null,
          `Expected null thumbnailUrl for ${fixture.filename}`,
        );
      });
    } else {
      it(`extracts correct YouTube thumbnail URL from "${fixture.filename}"`, () => {
        const buffer = loadSample(fixture.filename);
        const metadata = extractArticleMetadata(buffer);
        assert.equal(
          metadata.thumbnailUrl,
          fixture.expectedThumbnailUrl,
          `ThumbnailUrl mismatch for ${fixture.filename}`,
        );
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Tests: error paths (synthetic HTML)
// ---------------------------------------------------------------------------

describe('extractArticleMetadata — error paths', () => {
  it('throws ArticleMetadataError with code EMPTY_TITLE when <title> is missing', () => {
    const html = Buffer.from('<!DOCTYPE html><html><head></head><body></body></html>');
    assert.throws(
      () => extractArticleMetadata(html),
      (err: unknown) => {
        assert.ok(err instanceof ArticleMetadataError, 'Expected ArticleMetadataError');
        assert.equal(err.code, 'EMPTY_TITLE');
        return true;
      },
    );
  });

  it('throws ArticleMetadataError with code EMPTY_TITLE when <title> is whitespace-only', () => {
    const html = Buffer.from(
      '<!DOCTYPE html><html><head><title>   </title></head><body></body></html>',
    );
    assert.throws(
      () => extractArticleMetadata(html),
      (err: unknown) => {
        assert.ok(err instanceof ArticleMetadataError, 'Expected ArticleMetadataError');
        assert.equal(err.code, 'EMPTY_TITLE');
        return true;
      },
    );
  });

  it('throws ArticleMetadataError with code IMG_NO_SRC when <img> has no src attribute', () => {
    const html = Buffer.from(
      '<!DOCTYPE html><html><head><title>Test</title></head><body><img alt="no src here"></body></html>',
    );
    assert.throws(
      () => extractArticleMetadata(html),
      (err: unknown) => {
        assert.ok(err instanceof ArticleMetadataError, 'Expected ArticleMetadataError');
        assert.equal(err.code, 'IMG_NO_SRC');
        return true;
      },
    );
  });

  it('throws ArticleMetadataError with code IMG_NO_SRC when <img> has empty src attribute', () => {
    const html = Buffer.from(
      '<!DOCTYPE html><html><head><title>Test</title></head><body><img src=""></body></html>',
    );
    assert.throws(
      () => extractArticleMetadata(html),
      (err: unknown) => {
        assert.ok(err instanceof ArticleMetadataError, 'Expected ArticleMetadataError');
        assert.equal(err.code, 'IMG_NO_SRC');
        return true;
      },
    );
  });

  it('returns thumbnailUrl: null (no error) when HTML has a title but no <img> at all', () => {
    const html = Buffer.from(
      '<!DOCTYPE html><html><head><title>Article without image</title></head><body><p>Text only.</p></body></html>',
    );
    const metadata = extractArticleMetadata(html);
    assert.equal(metadata.title, 'Article without image');
    assert.equal(metadata.thumbnailUrl, null);
  });

  it('ArticleMetadataError has correct name property', () => {
    const html = Buffer.from('<!DOCTYPE html><html><head></head><body></body></html>');
    assert.throws(
      () => extractArticleMetadata(html),
      (err: unknown) => {
        assert.ok(err instanceof ArticleMetadataError, 'Expected ArticleMetadataError');
        assert.equal((err as ArticleMetadataError).name, 'ArticleMetadataError');
        return true;
      },
    );
  });

  it('ArticleMetadataError is instanceof Error', () => {
    const html = Buffer.from('<!DOCTYPE html><html><head></head><body></body></html>');
    assert.throws(
      () => extractArticleMetadata(html),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'Expected Error base class');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Tests: edge-case extraction behaviour
// ---------------------------------------------------------------------------

describe('extractArticleMetadata — edge cases', () => {
  it('trims surrounding whitespace from <title>', () => {
    const html = Buffer.from(
      '<!DOCTYPE html><html><head><title>  Trimmed Title  </title></head><body></body></html>',
    );
    const metadata = extractArticleMetadata(html);
    assert.equal(metadata.title, 'Trimmed Title');
  });

  it('uses first <img> in document order, not a later one', () => {
    const html = Buffer.from(
      '<!DOCTYPE html><html><head><title>Multi-image</title></head><body>' +
        '<img src="https://first.example/image.jpg">' +
        '<img src="https://second.example/image.jpg">' +
        '</body></html>',
    );
    const metadata = extractArticleMetadata(html);
    assert.equal(metadata.thumbnailUrl, 'https://first.example/image.jpg');
  });

  it('returns the src value as-is (no normalization)', () => {
    const rawSrc = 'https://img.youtube.com/vi/efRIrLXoOVA/maxresdefault.jpg';
    const html = Buffer.from(
      `<!DOCTYPE html><html><head><title>Raw</title></head><body><img src="${rawSrc}"></body></html>`,
    );
    const metadata = extractArticleMetadata(html);
    assert.equal(metadata.thumbnailUrl, rawSrc);
  });
});
