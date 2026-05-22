/**
 * Catalog store — typed, validated, atomic in-memory + on-disk store for the
 * catalog manifest persisted at the configured `CATALOG_PATH`.
 *
 * Atomic write protocol:
 *   1. open `<path>.tmp` with `fs.open(path, 'w')`
 *   2. write the full JSON payload via `fileHandle.write(...)`
 *   3. fsync via `fileHandle.sync()`
 *   4. close
 *   5. `fs.rename(tmp, path)` — atomic on POSIX filesystems
 */

import { open, readFile, rename } from 'node:fs/promises';

import { isCatalogFile } from './types.js';
import type { CatalogEntry, CatalogFile } from './types.js';

export class CatalogStore {
  private entries: CatalogEntry[] = [];
  private updatedAt: string = new Date(0).toISOString();
  private loaded = false;

  constructor(private readonly catalogPath: string) {}

  /**
   * Read the catalog file from disk, validate its shape, and cache it
   * in memory. Throws if the file is missing, unparseable, or fails
   * schema validation.
   */
  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.catalogPath, 'utf8');
    } catch (cause) {
      throw new Error(
        `Failed to read catalog file at ${this.catalogPath}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new Error(
        `Catalog file at ${this.catalogPath} is not valid JSON: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }

    if (!isCatalogFile(parsed)) {
      throw new Error(
        `Catalog file at ${this.catalogPath} does not match the expected schema (schemaVersion=1, entries[], updatedAt)`,
      );
    }

    this.entries = parsed.entries.slice();
    this.updatedAt = parsed.updatedAt;
    this.loaded = true;
  }

  /**
   * Return a frozen snapshot of the cached entries. The returned array
   * is independent of the internal cache — mutations on the returned
   * value cannot affect store state.
   */
  snapshot(): readonly CatalogEntry[] {
    this.assertLoaded();
    return Object.freeze(this.entries.map((e) => ({ ...e })));
  }

  /**
   * Locate a single entry by its slug, or `null` if none matches.
   */
  getBySlug(slug: string): CatalogEntry | null {
    this.assertLoaded();
    const found = this.entries.find((e) => e.slug === slug);
    return found ? { ...found } : null;
  }

  /**
   * Return the set of slugs currently in use, suitable for passing to
   * `slugify()` for collision detection.
   */
  existingSlugs(): ReadonlySet<string> {
    this.assertLoaded();
    return new Set(this.entries.map((e) => e.slug));
  }

  /**
   * Append a new entry and atomically persist the updated manifest.
   * Re-loads the file into memory after the rename so the cache reflects
   * exactly what is on disk.
   */
  async append(entry: CatalogEntry): Promise<void> {
    this.assertLoaded();
    if (this.entries.some((e) => e.slug === entry.slug)) {
      throw new Error(`Cannot append: slug "${entry.slug}" already exists in catalog`);
    }
    const nextEntries = this.entries.concat(entry);
    const nextFile: CatalogFile = {
      schemaVersion: 1,
      entries: nextEntries,
      updatedAt: new Date().toISOString(),
    };
    await this.atomicWrite(nextFile);
    await this.load();
  }

  /**
   * Update mutable fields of an existing entry by slug. The slug and
   * publishedAt are immutable; any other field may be overridden via
   * the `patch` argument. Throws if the slug is not present.
   */
  async updateBySlug(
    slug: string,
    patch: Partial<Omit<CatalogEntry, 'slug' | 'publishedAt'>>,
  ): Promise<void> {
    this.assertLoaded();
    const idx = this.entries.findIndex((e) => e.slug === slug);
    if (idx === -1) {
      throw new Error(`Cannot update: slug "${slug}" not found in catalog`);
    }
    const current = this.entries[idx];
    if (current === undefined) {
      // This branch is unreachable given the findIndex check above, but
      // it keeps `noUncheckedIndexedAccess` happy.
      throw new Error(`Cannot update: slug "${slug}" not found in catalog`);
    }
    const merged: CatalogEntry = {
      ...current,
      ...patch,
      // slug and publishedAt are immutable.
      slug: current.slug,
      publishedAt: current.publishedAt,
    };
    const nextEntries = this.entries.slice();
    nextEntries[idx] = merged;
    const nextFile: CatalogFile = {
      schemaVersion: 1,
      entries: nextEntries,
      updatedAt: new Date().toISOString(),
    };
    await this.atomicWrite(nextFile);
    await this.load();
  }

  /**
   * Atomic write helper — write to `<path>.tmp`, fsync, close, then rename
   * over the target path.
   */
  private async atomicWrite(file: CatalogFile): Promise<void> {
    const tmpPath = `${this.catalogPath}.tmp`;
    const payload = `${JSON.stringify(file, null, 2)}\n`;

    const handle = await open(tmpPath, 'w');
    try {
      await handle.write(payload, 0, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmpPath, this.catalogPath);
  }

  private assertLoaded(): void {
    if (!this.loaded) {
      throw new Error(
        `CatalogStore at ${this.catalogPath} has not been loaded — call load() first`,
      );
    }
  }
}
