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

import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { open, readFile, rename } from 'node:fs/promises';
import * as path from 'node:path';

import { CATALOG_CATEGORIES, isCatalogFile } from './types.js';
import type { CatalogEntry, CatalogFile } from './types.js';

/** Callback invoked after a successful hot-reload. */
export type CatalogChangeListener = (entries: readonly CatalogEntry[]) => void;

/** Default debounce window between an fs event and the reload call. */
const DEFAULT_WATCH_DEBOUNCE_MS = 150;

export class CatalogStore {
  private entries: CatalogEntry[] = [];
  private updatedAt: string = new Date(0).toISOString();
  private loaded = false;

  // --- hot-reload state ---
  private watcher: FSWatcher | null = null;
  private watchDebounceTimer: NodeJS.Timeout | null = null;
  private watchDebounceMs: number = DEFAULT_WATCH_DEBOUNCE_MS;
  private changeListeners: CatalogChangeListener[] = [];
  /** Reload-error handler, defaults to console.error. */
  private onWatchError: (err: Error) => void = (err) => {
    // eslint-disable-next-line no-console
    console.error(`[CatalogStore] hot-reload failed: ${err.message}`);
  };

  /** Allowed `category` values for on-disk validation. Defaults to the
   * public flow's CATALOG_CATEGORIES; the experimental flow constructs the
   * store with EXPERIMENTAL_CATALOG_CATEGORIES so 'tools' is accepted. */
  private readonly allowedCategories: readonly string[];

  constructor(
    private readonly catalogPath: string,
    options: { allowedCategories?: readonly string[] } = {},
  ) {
    this.allowedCategories = options.allowedCategories ?? CATALOG_CATEGORIES;
  }

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

    if (!isCatalogFile(parsed, this.allowedCategories)) {
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

  // ===========================================================================
  // Hot reload
  // ===========================================================================

  /**
   * Begin watching the catalog file for external changes (e.g. another
   * process — typically the `publish-article` CLI — atomically rewrites it).
   * Each detected change triggers a debounced `load()` so the in-memory
   * cache reflects what is on disk without requiring a server restart.
   *
   * Implementation notes:
   *
   * - We watch the *parent directory* of the catalog path rather than the
   *   file itself, then filter events to the catalog's basename. This is
   *   robust against the atomic-rename publish protocol — `fs.watch` on a
   *   single file loses its handle after a `rename()` overwrites it, but
   *   watching the directory continues to see new-file events for the same
   *   path.
   *
   * - Events are debounced by `debounceMs` (default 150 ms). The publish
   *   protocol writes a `.tmp`, fsyncs, closes, then renames — depending on
   *   the platform the dir-watcher may fire two or three events back-to-back
   *   (rename of `.tmp`, change on target). Debouncing collapses them into
   *   a single reload.
   *
   * - Any reload error (catalog briefly missing during rename, malformed
   *   JSON mid-write) is routed to `onError` rather than crashing the watch
   *   loop. The watcher keeps running and will pick up the next valid write.
   *
   * - Calling `startWatch()` while already watching is a no-op (idempotent).
   *
   * The optional `onError` parameter replaces the default error handler
   * (which logs via `console.error`). Returns nothing — the watcher is
   * fire-and-forget; use `stopWatch()` for cleanup.
   */
  startWatch(
    options: {
      debounceMs?: number;
      onError?: (err: Error) => void;
    } = {},
  ): void {
    this.assertLoaded();
    if (this.watcher !== null) return;

    if (typeof options.debounceMs === 'number' && options.debounceMs >= 0) {
      this.watchDebounceMs = options.debounceMs;
    }
    if (typeof options.onError === 'function') {
      this.onWatchError = options.onError;
    }

    const absCatalogPath = path.resolve(this.catalogPath);
    const dir = path.dirname(absCatalogPath);
    const base = path.basename(absCatalogPath);

    this.watcher = watch(dir, { persistent: false }, (_eventType, filename) => {
      if (filename === null || filename !== base) return;
      this.scheduleReload();
    });

    this.watcher.on('error', (err) => {
      this.onWatchError(err instanceof Error ? err : new Error(String(err)));
    });
  }

  /**
   * Stop watching for catalog changes. Cancels any pending debounced reload
   * and releases the underlying `FSWatcher`. Idempotent — safe to call when
   * the watcher was never started.
   */
  async stopWatch(): Promise<void> {
    if (this.watchDebounceTimer !== null) {
      clearTimeout(this.watchDebounceTimer);
      this.watchDebounceTimer = null;
    }
    if (this.watcher !== null) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Register a callback to be invoked after every successful hot-reload.
   * The callback receives a fresh `snapshot()` of the entries. Returns an
   * unsubscribe function. Listeners are called synchronously after the
   * cache is updated; any exception they throw is routed to `onWatchError`
   * so a buggy listener cannot break the watcher.
   */
  onChange(listener: CatalogChangeListener): () => void {
    this.changeListeners.push(listener);
    return () => {
      const idx = this.changeListeners.indexOf(listener);
      if (idx !== -1) this.changeListeners.splice(idx, 1);
    };
  }

  /**
   * Debounced reload trigger. Internal — only called by the watch callback.
   */
  private scheduleReload(): void {
    if (this.watchDebounceTimer !== null) {
      clearTimeout(this.watchDebounceTimer);
    }
    this.watchDebounceTimer = setTimeout(() => {
      this.watchDebounceTimer = null;
      this.reloadFromDisk().catch((err) => {
        this.onWatchError(err instanceof Error ? err : new Error(String(err)));
      });
    }, this.watchDebounceMs);
  }

  /**
   * Internal: re-read the catalog from disk and fire change listeners.
   * Errors propagate to the caller (the timer callback), which routes them
   * to `onWatchError`.
   */
  private async reloadFromDisk(): Promise<void> {
    await this.load();
    if (this.changeListeners.length === 0) return;
    const snap = this.snapshot();
    for (const listener of this.changeListeners.slice()) {
      try {
        listener(snap);
      } catch (cause) {
        this.onWatchError(
          cause instanceof Error ? cause : new Error(String(cause)),
        );
      }
    }
  }
}
