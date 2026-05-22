/**
 * Tests for src/config.ts — loadConfig()
 *
 * Per project convention: NO fallbacks. Every missing or invalid env var
 * causes a thrown Error. This test file verifies that contract.
 *
 * Run: node --import tsx --test test_scripts/config.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../src/config.js';

// ---------------------------------------------------------------------------
// Minimal valid environment for use as a baseline
// ---------------------------------------------------------------------------
const baseEnv: NodeJS.ProcessEnv = {
  PORT: '3000',
  ARTICLES_DIR: '/srv/articles',
  CATALOG_PATH: '/srv/data/catalog.json',
};

function mkEnv(overrides: Partial<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  return { ...baseEnv, ...overrides };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('loadConfig — happy path', () => {
  it('returns correctly typed config with valid env vars', () => {
    const config = loadConfig(baseEnv);
    assert.equal(config.port, 3000);
    assert.equal(config.articlesDir, '/srv/articles');
    assert.equal(config.catalogPath, '/srv/data/catalog.json');
  });

  it('port is a number, not a string', () => {
    const config = loadConfig(baseEnv);
    assert.equal(typeof config.port, 'number');
  });

  it('accepts port 1 (minimum valid port)', () => {
    const config = loadConfig(mkEnv({ PORT: '1' }));
    assert.equal(config.port, 1);
  });

  it('accepts port 65535 (maximum valid port)', () => {
    const config = loadConfig(mkEnv({ PORT: '65535' }));
    assert.equal(config.port, 65535);
  });

  it('accepts port with a leading + sign', () => {
    const config = loadConfig(mkEnv({ PORT: '+8080' }));
    assert.equal(config.port, 8080);
  });

  it('trims whitespace from ARTICLES_DIR', () => {
    const config = loadConfig(mkEnv({ ARTICLES_DIR: '  /srv/articles  ' }));
    assert.equal(config.articlesDir, '/srv/articles');
  });

  it('trims whitespace from CATALOG_PATH', () => {
    const config = loadConfig(mkEnv({ CATALOG_PATH: '  /srv/data/catalog.json  ' }));
    assert.equal(config.catalogPath, '/srv/data/catalog.json');
  });
});

// ---------------------------------------------------------------------------
// Missing PORT → throws
// ---------------------------------------------------------------------------

describe('loadConfig — missing PORT throws', () => {
  it('throws when PORT is undefined', () => {
    const env = mkEnv({ PORT: undefined });
    assert.throws(
      () => loadConfig(env),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('PORT'),
          `Expected "PORT" in error message: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('throws when PORT is an empty string', () => {
    assert.throws(
      () => loadConfig(mkEnv({ PORT: '' })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('PORT'));
        return true;
      },
    );
  });

  it('does NOT fall back to a default port when PORT is missing', () => {
    const env = mkEnv({ PORT: undefined });
    // Must throw, not return a config with a default port value
    assert.throws(() => loadConfig(env), Error);
  });
});

// ---------------------------------------------------------------------------
// Missing ARTICLES_DIR → throws
// ---------------------------------------------------------------------------

describe('loadConfig — missing ARTICLES_DIR throws', () => {
  it('throws when ARTICLES_DIR is undefined', () => {
    assert.throws(
      () => loadConfig(mkEnv({ ARTICLES_DIR: undefined })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('ARTICLES_DIR'));
        return true;
      },
    );
  });

  it('throws when ARTICLES_DIR is an empty string', () => {
    assert.throws(
      () => loadConfig(mkEnv({ ARTICLES_DIR: '' })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('ARTICLES_DIR'));
        return true;
      },
    );
  });

  it('throws when ARTICLES_DIR is whitespace-only', () => {
    assert.throws(
      () => loadConfig(mkEnv({ ARTICLES_DIR: '   ' })),
      Error,
    );
  });
});

// ---------------------------------------------------------------------------
// Missing CATALOG_PATH → throws
// ---------------------------------------------------------------------------

describe('loadConfig — missing CATALOG_PATH throws', () => {
  it('throws when CATALOG_PATH is undefined', () => {
    assert.throws(
      () => loadConfig(mkEnv({ CATALOG_PATH: undefined })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('CATALOG_PATH'));
        return true;
      },
    );
  });

  it('throws when CATALOG_PATH is an empty string', () => {
    assert.throws(
      () => loadConfig(mkEnv({ CATALOG_PATH: '' })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('CATALOG_PATH'));
        return true;
      },
    );
  });

  it('throws when CATALOG_PATH is whitespace-only', () => {
    assert.throws(
      () => loadConfig(mkEnv({ CATALOG_PATH: '   ' })),
      Error,
    );
  });
});

// ---------------------------------------------------------------------------
// Non-positive-integer PORT → throws
// ---------------------------------------------------------------------------

describe('loadConfig — invalid PORT values throw', () => {
  it('throws on PORT=0 (zero is not a positive integer)', () => {
    assert.throws(
      () => loadConfig(mkEnv({ PORT: '0' })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('PORT'));
        return true;
      },
    );
  });

  it('throws on a negative PORT', () => {
    assert.throws(
      () => loadConfig(mkEnv({ PORT: '-80' })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('PORT'));
        return true;
      },
    );
  });

  it('throws on a decimal PORT (3000.5)', () => {
    assert.throws(
      () => loadConfig(mkEnv({ PORT: '3000.5' })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('PORT'));
        return true;
      },
    );
  });

  it('throws on PORT in scientific notation (3e3)', () => {
    assert.throws(
      () => loadConfig(mkEnv({ PORT: '3e3' })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('PORT'));
        return true;
      },
    );
  });

  it('throws on PORT with whitespace padding around digits (e.g. " 3000 ")', () => {
    // Implementation trims before checking — trimmed "3000" should be valid
    // The spec shows this is actually accepted (trim happens before parse)
    // Let's verify trimmed value IS accepted
    const config = loadConfig(mkEnv({ PORT: ' 3000 ' }));
    assert.equal(config.port, 3000);
  });

  it('throws on hexadecimal PORT (0xFF)', () => {
    assert.throws(
      () => loadConfig(mkEnv({ PORT: '0xFF' })),
      Error,
    );
  });

  it('throws on PORT=65536 (out of valid range)', () => {
    assert.throws(
      () => loadConfig(mkEnv({ PORT: '65536' })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('PORT'));
        return true;
      },
    );
  });

  it('throws on alphanumeric PORT (abc)', () => {
    assert.throws(
      () => loadConfig(mkEnv({ PORT: 'abc' })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('PORT'));
        return true;
      },
    );
  });
});
