/**
 * Hot-reload tests — CatalogStore.startWatch / stopWatch.
 *
 * Verifies that an external atomic rewrite of catalog.json is picked up by
 * a running store without explicit reload calls, and that the change is
 * observable through both `snapshot()` and the `onChange` listener.
 *
 * Uses os.tmpdir() + crypto.randomUUID() to isolate each test from the
 * project's real catalog and from sibling test files.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { CatalogStore } from '../src/catalog/store.js';
import type { CatalogEntry, CatalogFile } from '../src/catalog/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(slug: string, title: string, isoDate: string): CatalogEntry {
  return {
    slug,
    title,
    publishedAt: isoDate,
    sourcePath: `samples/${slug}.html`,
    articlePath: `articles/${slug}.html`,
    thumbnailUrl: 'https://img.youtube.com/vi/AAAAAAAAAAA/maxresdefault.jpg',
    thumbnailSource: 'html',
    sha256: 'a'.repeat(64),
  };
}

function makeFile(entries: CatalogEntry[]): CatalogFile {
  return {
    schemaVersion: 1,
    entries,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Mirror the production atomic-write protocol (open tmp -> write -> fsync ->
 * close -> rename) so the test exercises the same fs.watch event sequence
 * the real CLI produces.
 */
function atomicWriteCatalog(catalogPath: string, file: CatalogFile): void {
  const tmpPath = `${catalogPath}.tmp`;
  const payload = `${JSON.stringify(file, null, 2)}\n`;
  const fd = openSync(tmpPath, 'w');
  try {
    writeFileSync(fd, payload);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, catalogPath);
}

/**
 * Poll until `predicate()` returns true, or the timeout elapses.
 * Resolves true if the predicate passed in time, false otherwise.
 */
async function waitUntil(
  predicate: () => boolean,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const timeout = opts.timeoutMs ?? 2000;
  const interval = opts.intervalMs ?? 25;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, interval));
  }
  return predicate();
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CatalogStore — hot reload via startWatch/stopWatch', () => {
  let workDir: string;
  let catalogPath: string;

  before(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'catalog-hotreload-'));
    catalogPath = path.join(workDir, 'catalog.json');
  });

  after(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it('reloads the cache when the catalog file is atomically rewritten', async () => {
    // Seed with one entry.
    atomicWriteCatalog(
      catalogPath,
      makeFile([makeEntry('alpha', 'Alpha', '2026-05-01T00:00:00Z')]),
    );

    const store = new CatalogStore(catalogPath);
    await store.load();
    assert.equal(store.snapshot().length, 1);
    assert.equal(store.snapshot()[0]?.slug, 'alpha');

    // Start watching; very short debounce so the test stays fast.
    store.startWatch({ debounceMs: 25 });

    try {
      // External rewrite — add a second entry.
      atomicWriteCatalog(
        catalogPath,
        makeFile([
          makeEntry('alpha', 'Alpha', '2026-05-01T00:00:00Z'),
          makeEntry('beta', 'Beta', '2026-05-02T00:00:00Z'),
        ]),
      );

      const observed = await waitUntil(() => store.snapshot().length === 2, {
        timeoutMs: 2000,
      });
      assert.ok(observed, 'expected store to reflect the new entry within 2s');
      const slugs = store.snapshot().map((e) => e.slug).sort();
      assert.deepEqual(slugs, ['alpha', 'beta']);
    } finally {
      await store.stopWatch();
    }
  });

  it('fires onChange listeners after a successful reload', async () => {
    // Reset the file.
    atomicWriteCatalog(catalogPath, makeFile([]));

    const store = new CatalogStore(catalogPath);
    await store.load();

    let calls = 0;
    let lastSeenLength = -1;
    store.onChange((entries) => {
      calls += 1;
      lastSeenLength = entries.length;
    });

    store.startWatch({ debounceMs: 25 });

    try {
      atomicWriteCatalog(
        catalogPath,
        makeFile([makeEntry('gamma', 'Gamma', '2026-05-03T00:00:00Z')]),
      );

      const observed = await waitUntil(() => calls >= 1, { timeoutMs: 2000 });
      assert.ok(observed, 'onChange listener should have fired');
      assert.equal(lastSeenLength, 1, 'listener should see the new snapshot length');
    } finally {
      await store.stopWatch();
    }
  });

  it('stopWatch prevents further reloads', async () => {
    atomicWriteCatalog(
      catalogPath,
      makeFile([makeEntry('delta', 'Delta', '2026-05-04T00:00:00Z')]),
    );

    const store = new CatalogStore(catalogPath);
    await store.load();
    assert.equal(store.snapshot().length, 1);

    store.startWatch({ debounceMs: 25 });
    await store.stopWatch();

    // Mutate the file after stopWatch — the store should NOT pick it up.
    atomicWriteCatalog(
      catalogPath,
      makeFile([
        makeEntry('delta', 'Delta', '2026-05-04T00:00:00Z'),
        makeEntry('epsilon', 'Epsilon', '2026-05-05T00:00:00Z'),
      ]),
    );

    // Wait long enough that, were the watcher still alive, it would have
    // fired by now (debounce 25ms + filesystem latency).
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(
      store.snapshot().length,
      1,
      'snapshot should still reflect pre-stopWatch state',
    );
  });

  it('routes reload errors to onError without crashing the watcher', async () => {
    atomicWriteCatalog(catalogPath, makeFile([]));
    const store = new CatalogStore(catalogPath);
    await store.load();

    const errors: Error[] = [];
    store.startWatch({
      debounceMs: 25,
      onError: (err) => { errors.push(err); },
    });

    try {
      // Write invalid JSON via the same atomic protocol — triggers a
      // load() failure inside the watcher.
      const tmpPath = `${catalogPath}.tmp`;
      writeFileSync(tmpPath, '{ this is not valid json');
      renameSync(tmpPath, catalogPath);

      const observed = await waitUntil(() => errors.length >= 1, {
        timeoutMs: 2000,
      });
      assert.ok(observed, 'expected onError to be called for invalid JSON');

      // Watcher should still be alive — a subsequent valid write must be picked up.
      atomicWriteCatalog(
        catalogPath,
        makeFile([makeEntry('zeta', 'Zeta', '2026-05-06T00:00:00Z')]),
      );
      const recovered = await waitUntil(
        () => store.snapshot().length === 1 && store.snapshot()[0]?.slug === 'zeta',
        { timeoutMs: 2000 },
      );
      assert.ok(recovered, 'watcher should recover and pick up the next valid write');
    } finally {
      await store.stopWatch();
    }
  });

  it('startWatch is idempotent (calling twice does not duplicate listeners)', async () => {
    atomicWriteCatalog(catalogPath, makeFile([]));
    const store = new CatalogStore(catalogPath);
    await store.load();

    let calls = 0;
    store.onChange(() => { calls += 1; });

    store.startWatch({ debounceMs: 25 });
    store.startWatch({ debounceMs: 25 }); // should be a no-op

    try {
      atomicWriteCatalog(
        catalogPath,
        makeFile([makeEntry('eta', 'Eta', '2026-05-07T00:00:00Z')]),
      );

      await waitUntil(() => calls >= 1, { timeoutMs: 2000 });
      // Give the system a beat to ensure no second fire.
      await new Promise((r) => setTimeout(r, 200));
      assert.equal(calls, 1, 'onChange should fire exactly once per write');
    } finally {
      await store.stopWatch();
    }
  });

  it('stopWatch is idempotent and safe before startWatch', async () => {
    const store = new CatalogStore(catalogPath);
    // Calling stopWatch before load/startWatch — must not throw.
    await store.stopWatch();
    await store.stopWatch();
  });
});
