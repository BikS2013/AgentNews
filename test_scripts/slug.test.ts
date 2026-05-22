/**
 * Tests for src/catalog/slug.ts — slugify()
 *
 * Run: node --import tsx --test test_scripts/slug.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { slugify } from '../src/catalog/slug.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const noTaken = new Set<string>();

// ---------------------------------------------------------------------------
// Basic kebab-case conversion
// ---------------------------------------------------------------------------

describe('slugify — basic kebab-case', () => {
  it('lowercases an all-caps title', () => {
    assert.equal(slugify('HELLO WORLD', noTaken), 'hello-world');
  });

  it('converts spaces to hyphens', () => {
    assert.equal(slugify('hello world', noTaken), 'hello-world');
  });

  it('collapses multiple spaces into one hyphen', () => {
    assert.equal(slugify('hello   world', noTaken), 'hello-world');
  });

  it('trims leading and trailing hyphens', () => {
    // Input starts/ends with non-alnum chars that become hyphens
    assert.equal(slugify('  hello world  ', noTaken), 'hello-world');
  });

  it('retains digits', () => {
    assert.equal(slugify('Section 42 Review', noTaken), 'section-42-review');
  });

  it('collapses a run of hyphens into one', () => {
    assert.equal(slugify('foo---bar', noTaken), 'foo-bar');
  });

  it('handles a single word', () => {
    assert.equal(slugify('TypeScript', noTaken), 'typescript');
  });

  it('replaces non-alnum non-hyphen chars with spaces then collapses', () => {
    // Apostrophe → space, comma → space, the rule replaces non-[a-z0-9 -] chars
    // "it's" → "it s" → "it-s"; "a test, really" → "a-test-really"
    // Full: "it-s-a-test-really"
    assert.equal(slugify("it's a test, really", noTaken), 'it-s-a-test-really');
  });
});

// ---------------------------------------------------------------------------
// Diacritic stripping via NFKD
// ---------------------------------------------------------------------------

describe('slugify — diacritic stripping (NFKD)', () => {
  it('strips accents from é', () => {
    assert.equal(slugify('Été chaud', noTaken), 'ete-chaud');
  });

  it('strips accents from ü, ö, ä', () => {
    assert.equal(slugify('über schön naïve', noTaken), 'uber-schon-naive');
  });

  it('strips accents from ñ', () => {
    assert.equal(slugify('El niño', noTaken), 'el-nino');
  });

  it('strips accents from ç', () => {
    assert.equal(slugify('français', noTaken), 'francais');
  });

  it('strips accents from à, â, ê, î, ô, û', () => {
    const result = slugify('à la carte', noTaken);
    assert.equal(result, 'a-la-carte');
  });

  it('preserves base ASCII letters after NFKD normalisation', () => {
    // 'café' is NFD for 'café' — should normalise to 'cafe'
    assert.equal(slugify('café', noTaken), 'cafe');
  });
});

// ---------------------------------------------------------------------------
// Collision suffix progression (-2, -3, …)
// ---------------------------------------------------------------------------

describe('slugify — collision suffix progression', () => {
  it('returns base slug when no collision', () => {
    assert.equal(slugify('hello world', noTaken), 'hello-world');
  });

  it('appends -2 when base is taken', () => {
    const taken = new Set(['hello-world']);
    assert.equal(slugify('hello world', taken), 'hello-world-2');
  });

  it('appends -3 when base and -2 are taken', () => {
    const taken = new Set(['hello-world', 'hello-world-2']);
    assert.equal(slugify('hello world', taken), 'hello-world-3');
  });

  it('appends -4 when base, -2, -3 are taken', () => {
    const taken = new Set(['hello-world', 'hello-world-2', 'hello-world-3']);
    assert.equal(slugify('hello world', taken), 'hello-world-4');
  });

  it('skips to next free suffix when intermediate suffixes are not taken', () => {
    // Only base is taken; -2 is free
    const taken = new Set(['foo-bar']);
    assert.equal(slugify('foo bar', taken), 'foo-bar-2');
  });

  it('does not modify the taken set (no mutation)', () => {
    const taken = new Set(['my-slug']);
    const sizeBefore = taken.size;
    slugify('my slug', taken);
    assert.equal(taken.size, sizeBefore);
  });

  it('suffix counter is independent per call (no shared state)', () => {
    const taken1 = new Set(['alpha']);
    const taken2 = new Set(['alpha', 'alpha-2']);
    assert.equal(slugify('alpha', taken1), 'alpha-2');
    assert.equal(slugify('alpha', taken2), 'alpha-3');
  });
});

// ---------------------------------------------------------------------------
// Empty-after-strip → throws
// ---------------------------------------------------------------------------

describe('slugify — throws on unslugifiable title', () => {
  it('throws on a title that is only special characters', () => {
    assert.throws(
      () => slugify('!!!@@@###', noTaken),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('Cannot derive slug'),
          `Expected "Cannot derive slug" in: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('throws on a title consisting solely of hyphens', () => {
    assert.throws(() => slugify('---', noTaken), Error);
  });

  it('throws on a title of only whitespace', () => {
    assert.throws(
      () => slugify('   ', noTaken),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('Cannot derive slug'));
        return true;
      },
    );
  });

  it('throws on an empty string', () => {
    assert.throws(
      () => slugify('', noTaken),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('Cannot derive slug'));
        return true;
      },
    );
  });

  it('throws when all chars are diacritics that strip to nothing (combining marks only)', () => {
    // U+0301 is a pure combining mark — after NFKD+strip it becomes empty
    assert.throws(
      () => slugify('́̂̃', noTaken),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('Cannot derive slug'));
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Regex assertion — final slug shape
// ---------------------------------------------------------------------------

describe('slugify — output always matches /^[a-z0-9]+(-[a-z0-9]+)*$/', () => {
  const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  const cases: Array<[string, ReadonlySet<string>]> = [
    ['Simple Title', noTaken],
    ['Deep Dive — /handoff is my new favourite skill (Matt Pocock)', noTaken],
    ['TypeScript 5.0 Released!!!', noTaken],
    ['café au lait', noTaken],
    ['über-engineering at Scale', noTaken],
    ['100 Things I Learned in 2024', noTaken],
    ['A', noTaken],
    ['a b', new Set(['a-b'])],                // collision → a-b-2
    ['a b', new Set(['a-b', 'a-b-2'])],       // collision → a-b-3
  ];

  for (const [title, taken] of cases) {
    it(`slug for "${title.slice(0, 50)}" matches regex`, () => {
      const slug = slugify(title, taken);
      assert.match(
        slug,
        SLUG_REGEX,
        `Slug "${slug}" does not match /^[a-z0-9]+(-[a-z0-9]+)*$/`,
      );
    });
  }
});
