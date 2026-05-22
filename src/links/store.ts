/**
 * Links store — typed, validated, atomic in-memory + on-disk store for the
 * external-articles manifest persisted at the configured `LINKS_PATH`.
 *
 * Mirrors the API surface of `src/catalog/store.ts` (load / snapshot /
 * append / updateById / hot-reload) but operates on `LinkEntry` records
 * keyed by `id` rather than `slug`. Atomic write protocol and fs.watch-
 * based hot-reload are identical.
 */

import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { open, readFile, rename } from 'node:fs/promises';
import * as path from 'node:path';

import { isLinksFile } from './types.js';
import type { LinkEntry, LinksFile } from './types.js';

/** Callback invoked after a successful hot-reload. */
export type LinksChangeListener = (entries: readonly LinkEntry[]) => void;

const DEFAULT_WATCH_DEBOUNCE_MS = 150;

export class LinksStore {
  private entries: LinkEntry[] = [];
  private updatedAt: string = new Date(0).toISOString();
  private loaded = false;

  // --- hot-reload state ---
  private watcher: FSWatcher | null = null;
  private watchDebounceTimer: NodeJS.Timeout | null = null;
  private watchDebounceMs: number = DEFAULT_WATCH_DEBOUNCE_MS;
  private changeListeners: LinksChangeListener[] = [];
  private onWatchError: (err: Error) => void = (err) => {
    // eslint-disable-next-line no-console
    console.error(`[LinksStore] hot-reload failed: ${err.message}`);
  };

  constructor(private readonly linksPath: string) {}

  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.linksPath, 'utf8');
    } catch (cause) {
      throw new Error(
        `Failed to read links file at ${this.linksPath}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw new Error(
        `Links file at ${this.linksPath} is not valid JSON: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
    }

    if (!isLinksFile(parsed)) {
      throw new Error(
        `Links file at ${this.linksPath} does not match the expected schema (schemaVersion=1, entries[], updatedAt)`,
      );
    }

    this.entries = parsed.entries.slice();
    this.updatedAt = parsed.updatedAt;
    this.loaded = true;
  }

  snapshot(): readonly LinkEntry[] {
    this.assertLoaded();
    return Object.freeze(this.entries.map((e) => ({ ...e })));
  }

  getById(id: string): LinkEntry | null {
    this.assertLoaded();
    const found = this.entries.find((e) => e.id === id);
    return found ? { ...found } : null;
  }

  existingIds(): ReadonlySet<string> {
    this.assertLoaded();
    return new Set(this.entries.map((e) => e.id));
  }

  async append(entry: LinkEntry): Promise<void> {
    this.assertLoaded();
    if (this.entries.some((e) => e.id === entry.id)) {
      throw new Error(`Cannot append: id "${entry.id}" already exists in links`);
    }
    const nextEntries = this.entries.concat(entry);
    const nextFile: LinksFile = {
      schemaVersion: 1,
      entries: nextEntries,
      updatedAt: new Date().toISOString(),
    };
    await this.atomicWrite(nextFile);
    await this.load();
  }

  async updateById(
    id: string,
    patch: Partial<Omit<LinkEntry, 'id' | 'publishedAt'>>,
  ): Promise<void> {
    this.assertLoaded();
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) {
      throw new Error(`Cannot update: id "${id}" not found in links`);
    }
    const current = this.entries[idx];
    if (current === undefined) {
      throw new Error(`Cannot update: id "${id}" not found in links`);
    }
    const merged: LinkEntry = {
      ...current,
      ...patch,
      id: current.id,
      publishedAt: current.publishedAt,
    };
    const nextEntries = this.entries.slice();
    nextEntries[idx] = merged;
    const nextFile: LinksFile = {
      schemaVersion: 1,
      entries: nextEntries,
      updatedAt: new Date().toISOString(),
    };
    await this.atomicWrite(nextFile);
    await this.load();
  }

  private async atomicWrite(file: LinksFile): Promise<void> {
    const tmpPath = `${this.linksPath}.tmp`;
    const payload = `${JSON.stringify(file, null, 2)}\n`;

    const handle = await open(tmpPath, 'w');
    try {
      await handle.write(payload, 0, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmpPath, this.linksPath);
  }

  private assertLoaded(): void {
    if (!this.loaded) {
      throw new Error(
        `LinksStore at ${this.linksPath} has not been loaded — call load() first`,
      );
    }
  }

  // ===========================================================================
  // Hot reload
  // ===========================================================================

  /**
   * Begin watching the links file for external changes (e.g. `publish-link`
   * atomically rewriting it). See `CatalogStore.startWatch` for the full
   * design rationale — the implementation is identical, only the file
   * differs.
   */
  startWatch(
    options: { debounceMs?: number; onError?: (err: Error) => void } = {},
  ): void {
    this.assertLoaded();
    if (this.watcher !== null) return;

    if (typeof options.debounceMs === 'number' && options.debounceMs >= 0) {
      this.watchDebounceMs = options.debounceMs;
    }
    if (typeof options.onError === 'function') {
      this.onWatchError = options.onError;
    }

    const absPath = path.resolve(this.linksPath);
    const dir = path.dirname(absPath);
    const base = path.basename(absPath);

    this.watcher = watch(dir, { persistent: false }, (_eventType, filename) => {
      if (filename === null || filename !== base) return;
      this.scheduleReload();
    });

    this.watcher.on('error', (err) => {
      this.onWatchError(err instanceof Error ? err : new Error(String(err)));
    });
  }

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

  onChange(listener: LinksChangeListener): () => void {
    this.changeListeners.push(listener);
    return () => {
      const idx = this.changeListeners.indexOf(listener);
      if (idx !== -1) this.changeListeners.splice(idx, 1);
    };
  }

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
