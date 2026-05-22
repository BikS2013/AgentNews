/**
 * Tests for src/catalog/types.ts — isCatalogFile() and isCatalogEntry()
 *
 * Run: node --import tsx --test test_scripts/types.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isCatalogFile, isCatalogEntry } from '../src/catalog/types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validEntry = {
  slug: 'hello-world',
  title: 'Hello World',
  publishedAt: '2024-01-15T12:00:00.000Z',
  sourcePath: '/home/user/articles/hello-world.html',
  articlePath: 'articles/hello-world.html',
  thumbnailUrl: 'https://img.youtube.com/vi/abc123/maxresdefault.jpg',
  thumbnailSource: 'html' as const,
  sha256: 'a'.repeat(64),
};

const validFile = {
  schemaVersion: 1 as const,
  entries: [validEntry],
  updatedAt: '2024-01-15T12:00:00.000Z',
};

const emptyValidFile = {
  schemaVersion: 1 as const,
  entries: [],
  updatedAt: '2024-01-15T12:00:00.000Z',
};

// ---------------------------------------------------------------------------
// isCatalogFile — accepts valid envelopes
// ---------------------------------------------------------------------------

describe('isCatalogFile — accepts valid envelopes', () => {
  it('accepts a valid file with one entry', () => {
    assert.ok(isCatalogFile(validFile));
  });

  it('accepts a valid file with an empty entries array', () => {
    assert.ok(isCatalogFile(emptyValidFile));
  });

  it('accepts a valid file with multiple entries', () => {
    const file = {
      ...validFile,
      entries: [
        validEntry,
        { ...validEntry, slug: 'second-entry' },
      ],
    };
    assert.ok(isCatalogFile(file));
  });

  it('accepts thumbnailSource "cli-override"', () => {
    const file = {
      ...validFile,
      entries: [{ ...validEntry, thumbnailSource: 'cli-override' as const }],
    };
    assert.ok(isCatalogFile(file));
  });

  it('accepts ISO timestamp with timezone offset', () => {
    const file = {
      ...validFile,
      updatedAt: '2024-01-15T14:00:00+02:00',
    };
    assert.ok(isCatalogFile(file));
  });

  it('accepts ISO timestamp with fractional seconds', () => {
    const file = {
      ...validFile,
      updatedAt: '2024-01-15T12:00:00.123Z',
    };
    assert.ok(isCatalogFile(file));
  });
});

// ---------------------------------------------------------------------------
// isCatalogFile — rejects schemaVersion mismatch
// ---------------------------------------------------------------------------

describe('isCatalogFile — rejects schemaVersion mismatch', () => {
  it('rejects schemaVersion 2', () => {
    assert.equal(isCatalogFile({ ...validFile, schemaVersion: 2 }), false);
  });

  it('rejects schemaVersion 0', () => {
    assert.equal(isCatalogFile({ ...validFile, schemaVersion: 0 }), false);
  });

  it('rejects schemaVersion as string "1"', () => {
    assert.equal(isCatalogFile({ ...validFile, schemaVersion: '1' }), false);
  });

  it('rejects missing schemaVersion', () => {
    const { schemaVersion: _sv, ...rest } = validFile;
    assert.equal(isCatalogFile(rest), false);
  });
});

// ---------------------------------------------------------------------------
// isCatalogFile — rejects missing top-level fields
// ---------------------------------------------------------------------------

describe('isCatalogFile — rejects missing top-level fields', () => {
  it('rejects missing entries array', () => {
    const { entries: _e, ...rest } = validFile;
    assert.equal(isCatalogFile(rest), false);
  });

  it('rejects missing updatedAt', () => {
    const { updatedAt: _u, ...rest } = validFile;
    assert.equal(isCatalogFile(rest), false);
  });

  it('rejects null', () => {
    assert.equal(isCatalogFile(null), false);
  });

  it('rejects undefined', () => {
    assert.equal(isCatalogFile(undefined), false);
  });

  it('rejects a string', () => {
    assert.equal(isCatalogFile('{"schemaVersion":1}'), false);
  });

  it('rejects an array', () => {
    assert.equal(isCatalogFile([validFile]), false);
  });
});

// ---------------------------------------------------------------------------
// isCatalogFile — rejects wrong field types
// ---------------------------------------------------------------------------

describe('isCatalogFile — rejects wrong field types', () => {
  it('rejects non-array entries', () => {
    assert.equal(isCatalogFile({ ...validFile, entries: {} }), false);
  });

  it('rejects entries: null', () => {
    assert.equal(isCatalogFile({ ...validFile, entries: null }), false);
  });

  it('rejects non-ISO-8601 updatedAt', () => {
    assert.equal(isCatalogFile({ ...validFile, updatedAt: '2024-01-15' }), false);
  });

  it('rejects numeric updatedAt', () => {
    assert.equal(isCatalogFile({ ...validFile, updatedAt: 1705315200000 }), false);
  });
});

// ---------------------------------------------------------------------------
// isCatalogFile — rejects invalid entries inside the array
// ---------------------------------------------------------------------------

describe('isCatalogFile — rejects invalid entries', () => {
  it('rejects a file whose single entry has an invalid slug', () => {
    const file = {
      ...validFile,
      entries: [{ ...validEntry, slug: 'UPPERCASE-INVALID' }],
    };
    assert.equal(isCatalogFile(file), false);
  });

  it('rejects a file whose single entry has a missing title', () => {
    const { title: _t, ...entryNoTitle } = validEntry;
    assert.equal(isCatalogFile({ ...validFile, entries: [entryNoTitle] }), false);
  });

  it('rejects a file where one of multiple entries is invalid', () => {
    const file = {
      ...validFile,
      entries: [
        validEntry,
        { ...validEntry, slug: 'missing-sha256' as string, sha256: 'short' },
      ],
    };
    assert.equal(isCatalogFile(file), false);
  });
});

// ---------------------------------------------------------------------------
// isCatalogEntry — comprehensive field validation
// ---------------------------------------------------------------------------

describe('isCatalogEntry — slug validation', () => {
  it('rejects empty slug', () => {
    assert.equal(isCatalogEntry({ ...validEntry, slug: '' }), false);
  });

  it('rejects slug with uppercase letters', () => {
    assert.equal(isCatalogEntry({ ...validEntry, slug: 'Hello-World' }), false);
  });

  it('rejects slug with leading hyphen', () => {
    assert.equal(isCatalogEntry({ ...validEntry, slug: '-hello' }), false);
  });

  it('rejects slug with trailing hyphen', () => {
    assert.equal(isCatalogEntry({ ...validEntry, slug: 'hello-' }), false);
  });

  it('rejects slug with consecutive hyphens', () => {
    assert.equal(isCatalogEntry({ ...validEntry, slug: 'hello--world' }), false);
  });

  it('rejects slug with spaces', () => {
    assert.equal(isCatalogEntry({ ...validEntry, slug: 'hello world' }), false);
  });

  it('accepts single-word slug', () => {
    assert.ok(isCatalogEntry({ ...validEntry, slug: 'hello' }));
  });

  it('accepts slug with numbers', () => {
    assert.ok(isCatalogEntry({ ...validEntry, slug: 'article-42' }));
  });
});

describe('isCatalogEntry — sha256 validation', () => {
  it('rejects sha256 shorter than 64 chars', () => {
    assert.equal(isCatalogEntry({ ...validEntry, sha256: 'a'.repeat(63) }), false);
  });

  it('rejects sha256 longer than 64 chars', () => {
    assert.equal(isCatalogEntry({ ...validEntry, sha256: 'a'.repeat(65) }), false);
  });

  it('rejects sha256 with uppercase hex', () => {
    assert.equal(isCatalogEntry({ ...validEntry, sha256: 'A'.repeat(64) }), false);
  });

  it('rejects sha256 with non-hex chars', () => {
    assert.equal(isCatalogEntry({ ...validEntry, sha256: 'g'.repeat(64) }), false);
  });

  it('accepts all lowercase hex digits', () => {
    assert.ok(isCatalogEntry({ ...validEntry, sha256: '0123456789abcdef'.repeat(4) }));
  });
});

describe('isCatalogEntry — thumbnailSource validation', () => {
  it('rejects unknown thumbnailSource', () => {
    assert.equal(isCatalogEntry({ ...validEntry, thumbnailSource: 'web' }), false);
  });

  it('rejects numeric thumbnailSource', () => {
    assert.equal(isCatalogEntry({ ...validEntry, thumbnailSource: 1 }), false);
  });

  it('accepts "html"', () => {
    assert.ok(isCatalogEntry({ ...validEntry, thumbnailSource: 'html' }));
  });

  it('accepts "cli-override"', () => {
    assert.ok(isCatalogEntry({ ...validEntry, thumbnailSource: 'cli-override' }));
  });
});

describe('isCatalogEntry — publishedAt validation', () => {
  it('rejects plain date (no time)', () => {
    assert.equal(isCatalogEntry({ ...validEntry, publishedAt: '2024-01-15' }), false);
  });

  it('rejects numeric timestamp', () => {
    assert.equal(isCatalogEntry({ ...validEntry, publishedAt: 1705315200000 }), false);
  });

  it('accepts Z suffix', () => {
    assert.ok(isCatalogEntry({ ...validEntry, publishedAt: '2024-01-15T12:00:00Z' }));
  });

  it('accepts +HH:MM timezone offset', () => {
    assert.ok(isCatalogEntry({ ...validEntry, publishedAt: '2024-01-15T14:00:00+02:00' }));
  });
});
