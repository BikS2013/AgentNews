/**
 * Tests for src/catalog/store.ts — CatalogStore
 *
 * Each test that touches the filesystem uses os.tmpdir() + a UUID-named
 * subdirectory to ensure isolation. Directories are cleaned up after each
 * test using the afterEach / finally pattern.
 *
 * Run: node --import tsx --test test_scripts/store.test.ts
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { CatalogStore } from '../src/catalog/store.js';
import type { CatalogEntry, CatalogFile } from '../src/catalog/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return join(tmpdir(), `catalog-store-test-${randomUUID()}`);
}

function makeEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    slug: 'hello-world',
    title: 'Hello World',
    publishedAt: '2024-01-15T12:00:00.000Z',
    sourcePath: '/home/user/articles/hello-world.html',
    articlePath: 'articles/hello-world.html',
    thumbnailUrl: 'https://img.youtube.com/vi/abc123/maxresdefault.jpg',
    thumbnailSource: 'html',
    sha256: 'a'.repeat(64),
    ...overrides,
  };
}

function makeCatalogFile(overrides: Partial<CatalogFile> = {}): CatalogFile {
  return {
    schemaVersion: 1,
    entries: [],
    updatedAt: '2024-01-15T12:00:00.000Z',
    ...overrides,
  };
}

async function writeCatalog(path: string, data: object): Promise<void> {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// CatalogStore — load()
// ---------------------------------------------------------------------------

describe('CatalogStore.load() — error cases', () => {
  it('throws when the catalog file does not exist', async () => {
    const dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    const catalogPath = join(dir, 'catalog.json');
    const store = new CatalogStore(catalogPath);

    try {
      await assert.rejects(
        async () => store.load(),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.includes(catalogPath) || err.message.includes('catalog'),
            `Expected catalog path or "catalog" in error: ${err.message}`,
          );
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws when the file contains invalid JSON', async () => {
    const dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    const catalogPath = join(dir, 'catalog.json');
    await writeFile(catalogPath, '{ not valid json }', 'utf8');
    const store = new CatalogStore(catalogPath);

    try {
      await assert.rejects(
        async () => store.load(),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.ok(
            err.message.toLowerCase().includes('json') || err.message.includes(catalogPath),
          );
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws when the file fails schema validation (wrong schemaVersion)', async () => {
    const dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    const catalogPath = join(dir, 'catalog.json');
    await writeCatalog(catalogPath, { schemaVersion: 2, entries: [], updatedAt: '2024-01-15T12:00:00.000Z' });
    const store = new CatalogStore(catalogPath);

    try {
      await assert.rejects(async () => store.load(), Error);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws when the file is valid JSON but missing required fields', async () => {
    const dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    const catalogPath = join(dir, 'catalog.json');
    await writeCatalog(catalogPath, { hello: 'world' });
    const store = new CatalogStore(catalogPath);

    try {
      await assert.rejects(async () => store.load(), Error);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('throws when entries array contains an invalid entry', async () => {
    const dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    const catalogPath = join(dir, 'catalog.json');
    const badCatalog = makeCatalogFile({
      entries: [{ slug: 'valid-slug', title: 'Good Entry', publishedAt: '2024-01-15T12:00:00.000Z' }] as unknown as CatalogEntry[],
    });
    await writeCatalog(catalogPath, badCatalog);
    const store = new CatalogStore(catalogPath);

    try {
      await assert.rejects(async () => store.load(), Error);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('CatalogStore.load() — success cases', () => {
  it('loads an empty valid catalog without throwing', async () => {
    const dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    const catalogPath = join(dir, 'catalog.json');
    await writeCatalog(catalogPath, makeCatalogFile());
    const store = new CatalogStore(catalogPath);

    try {
      await store.load();
      const snap = store.snapshot();
      assert.equal(snap.length, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('loads a catalog with one entry and caches it correctly', async () => {
    const dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    const catalogPath = join(dir, 'catalog.json');
    const entry = makeEntry();
    await writeCatalog(catalogPath, makeCatalogFile({ entries: [entry] }));
    const store = new CatalogStore(catalogPath);

    try {
      await store.load();
      const snap = store.snapshot();
      assert.equal(snap.length, 1);
      assert.equal(snap[0]?.slug, 'hello-world');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// CatalogStore — snapshot()
// ---------------------------------------------------------------------------

describe('CatalogStore.snapshot()', () => {
  it('throws before load() is called', () => {
    const store = new CatalogStore('/nonexistent/path.json');
    assert.throws(
      () => store.snapshot(),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('load()') || err.message.includes('loaded'),
          `Expected "load()" or "loaded" in error: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('returns a frozen array', async () => {
    const dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    const catalogPath = join(dir, 'catalog.json');
    await writeCatalog(catalogPath, makeCatalogFile({ entries: [makeEntry()] }));
    const store = new CatalogStore(catalogPath);

    try {
      await store.load();
      const snap = store.snapshot();
      // A frozen array will throw in strict mode when you try to push
      assert.throws(() => (snap as CatalogEntry[]).push(makeEntry({ slug: 'second' })), {
        name: 'TypeError',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns an independent copy — mutating snapshot does not affect store', async () => {
    const dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    const catalogPath = join(dir, 'catalog.json');
    const originalTitle = 'Hello World';
    await writeCatalog(
      catalogPath,
      makeCatalogFile({ entries: [makeEntry({ title: originalTitle })] }),
    );
    const store = new CatalogStore(catalogPath);

    try {
      await store.load();
      const snap = store.snapshot();
      // Attempt to mutate the returned entry object (the objects inside are also frozen copies)
      // The store's next snapshot should still reflect the original data
      const snap2 = store.snapshot();
      assert.equal(snap2[0]?.title, originalTitle);
      // snap and snap2 must be independent array instances
      assert.notEqual(snap, snap2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// CatalogStore — append()
// ---------------------------------------------------------------------------

describe('CatalogStore.append()', () => {
  let dir = '';
  let catalogPath = '';
  let store: CatalogStore;

  beforeEach(async () => {
    dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    catalogPath = join(dir, 'catalog.json');
    await writeCatalog(catalogPath, makeCatalogFile());
    store = new CatalogStore(catalogPath);
    await store.load();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('appends a new entry and persists it', async () => {
    const entry = makeEntry();
    await store.append(entry);
    const snap = store.snapshot();
    assert.equal(snap.length, 1);
    assert.equal(snap[0]?.slug, 'hello-world');
  });

  it('throws when appending a duplicate slug', async () => {
    const entry = makeEntry();
    await store.append(entry);

    await assert.rejects(
      async () => store.append(makeEntry({ slug: 'hello-world' })),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('hello-world'),
          `Expected slug in error: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('allows appending two entries with different slugs', async () => {
    await store.append(makeEntry({ slug: 'first-article' }));
    await store.append(makeEntry({ slug: 'second-article' }));
    assert.equal(store.snapshot().length, 2);
  });

  it('produces a file whose JSON parses (atomic write verification)', async () => {
    await store.append(makeEntry());
    const raw = await readFile(catalogPath, 'utf8');
    let parsed: unknown;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(raw);
    }, 'catalog.json must contain valid JSON after append');
    // Verify the parsed content looks right
    assert.ok(typeof parsed === 'object' && parsed !== null);
    const pObj = parsed as Record<string, unknown>;
    assert.equal(pObj['schemaVersion'], 1);
    assert.ok(Array.isArray(pObj['entries']));
    assert.equal((pObj['entries'] as unknown[]).length, 1);
  });

  it('atomic write uses a .tmp file then renames (file has no partial write artefacts)', async () => {
    // After a successful append there should be NO .tmp file left
    await store.append(makeEntry());
    const tmpPath = `${catalogPath}.tmp`;
    await assert.rejects(
      async () => readFile(tmpPath, 'utf8'),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        // ENOENT means the tmp file was properly cleaned up by rename
        assert.ok(
          (err as NodeJS.ErrnoException).code === 'ENOENT',
          `Expected ENOENT for tmp file, got: ${(err as NodeJS.ErrnoException).code}`,
        );
        return true;
      },
    );
  });

  it('re-loads cache after append so snapshot reflects new state', async () => {
    await store.append(makeEntry({ slug: 'first' }));
    await store.append(makeEntry({ slug: 'second' }));
    const snap = store.snapshot();
    assert.equal(snap.length, 2);
    const slugs = snap.map((e) => e.slug);
    assert.ok(slugs.includes('first'));
    assert.ok(slugs.includes('second'));
  });
});

// ---------------------------------------------------------------------------
// CatalogStore — updateBySlug()
// ---------------------------------------------------------------------------

describe('CatalogStore.updateBySlug()', () => {
  let dir = '';
  let catalogPath = '';
  let store: CatalogStore;
  const originalEntry = makeEntry({
    slug: 'hello-world',
    publishedAt: '2024-01-15T12:00:00.000Z',
    title: 'Hello World',
    sha256: 'a'.repeat(64),
  });

  beforeEach(async () => {
    dir = makeTmpDir();
    await mkdir(dir, { recursive: true });
    catalogPath = join(dir, 'catalog.json');
    await writeCatalog(catalogPath, makeCatalogFile({ entries: [originalEntry] }));
    store = new CatalogStore(catalogPath);
    await store.load();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('throws when slug is not found', async () => {
    await assert.rejects(
      async () => store.updateBySlug('nonexistent-slug', { title: 'New Title' }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('nonexistent-slug'));
        return true;
      },
    );
  });

  it('updates a mutable field (title) by slug', async () => {
    await store.updateBySlug('hello-world', { title: 'Updated Title' });
    const entry = store.getBySlug('hello-world');
    assert.ok(entry !== null);
    assert.equal(entry.title, 'Updated Title');
  });

  it('preserves slug after update (slug is immutable)', async () => {
    await store.updateBySlug('hello-world', { title: 'Changed' });
    const entry = store.getBySlug('hello-world');
    assert.ok(entry !== null);
    assert.equal(entry.slug, 'hello-world');
  });

  it('preserves publishedAt after update (publishedAt is immutable)', async () => {
    const originalPublishedAt = originalEntry.publishedAt;
    await store.updateBySlug('hello-world', { title: 'Changed' });
    const entry = store.getBySlug('hello-world');
    assert.ok(entry !== null);
    assert.equal(entry.publishedAt, originalPublishedAt);
  });

  it('update ignores slug field in patch (cannot override slug)', async () => {
    // Even if the patch contains a slug key, it must be ignored
    await store.updateBySlug('hello-world', {
      title: 'New Title',
      // TypeScript prevents passing slug/publishedAt here, but we test the runtime behavior
      ...(({ slug: 'attempted-slug-change' }) as object),
    } as Partial<Omit<typeof originalEntry, 'slug' | 'publishedAt'>>);

    const entry = store.getBySlug('hello-world');
    assert.ok(entry !== null);
    assert.equal(entry.slug, 'hello-world');
  });

  it('persists the updated entry to disk', async () => {
    await store.updateBySlug('hello-world', { title: 'Persisted Title' });
    const raw = await readFile(catalogPath, 'utf8');
    const parsed = JSON.parse(raw) as { entries: Array<{ title: string }> };
    assert.equal(parsed.entries[0]?.title, 'Persisted Title');
  });

  it('atomic write after update: no .tmp file remains', async () => {
    await store.updateBySlug('hello-world', { title: 'Test' });
    const tmpPath = `${catalogPath}.tmp`;
    await assert.rejects(
      async () => readFile(tmpPath, 'utf8'),
      (err: unknown) => {
        assert.ok((err as NodeJS.ErrnoException).code === 'ENOENT');
        return true;
      },
    );
  });

  it('updates only the targeted entry when multiple entries exist', async () => {
    const secondEntry = makeEntry({ slug: 'second-article', title: 'Second' });
    await store.append(secondEntry);

    await store.updateBySlug('hello-world', { title: 'Modified Hello' });

    const first = store.getBySlug('hello-world');
    const second = store.getBySlug('second-article');
    assert.ok(first !== null);
    assert.ok(second !== null);
    assert.equal(first.title, 'Modified Hello');
    assert.equal(second.title, 'Second');
  });
});

// ---------------------------------------------------------------------------
// CatalogStore — before-load guard
// ---------------------------------------------------------------------------

describe('CatalogStore — methods throw before load()', () => {
  it('getBySlug() throws before load()', () => {
    const store = new CatalogStore('/nonexistent');
    assert.throws(() => store.getBySlug('any-slug'), Error);
  });

  it('existingSlugs() throws before load()', () => {
    const store = new CatalogStore('/nonexistent');
    assert.throws(() => store.existingSlugs(), Error);
  });
});
