#!/usr/bin/env node
/**
 * publish-article CLI
 *
 * Ingests a source HTML article file, extracts metadata (title + first <img>),
 * derives a stable kebab-case slug, copies the file byte-identically into
 * `<articlesDir>/<slug>.html`, computes its SHA-256, and appends (or updates,
 * with --update) a CatalogEntry in `<catalogPath>`.
 *
 * Exit codes:
 *   0 — success
 *   1 — user/argument error (bad flag, missing required, no thumbnail, invalid date)
 *   2 — IO error (source not found, write failed)
 *   3 — conflict (already published without --update; --update target not found)
 *
 * No fallback configuration values are ever substituted — missing env vars
 * cause loadConfig() to throw.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import * as path from 'node:path';
import * as process from 'node:process';

import { CatalogStore } from '../catalog/store.js';
import { slugify } from '../catalog/slug.js';
import type { CatalogEntry } from '../catalog/types.js';
import { loadConfig } from '../config.js';
import { extractArticleMetadata } from '../extractor/extract.js';
import { ArticleMetadataError } from '../extractor/errors.js';
import {
  extractYouTubeVideoId,
  fetchYouTubeVideoPublishedAt,
  YouTubeFetchError,
} from '../extractor/youtube.js';

// ---------------------------------------------------------------------------
// argv parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  source: string;
  thumbnailUrl: string | null;
  update: boolean;
  date: string | null;
  help: boolean;
}

const USAGE = `Usage: publish-article --source <path> [options]

Required:
  --source <path>           Path to the source HTML article to publish.

Options:
  --thumbnail-url <url>     Override thumbnail URL (used only when the article
                            has no <img>).
  --update                  Replace an already-published article (preserves
                            slug and publishedAt; updates file + sha256 +
                            thumbnail + sourcePath).
  --date <ISO-8601>         Publication timestamp (defaults to now, ignored on
                            --update).
  --help                    Show this help and exit 0.

Exit codes:
  0 success, 1 user error, 2 IO error, 3 conflict.
`;

function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = {
    source: '',
    thumbnailUrl: null,
    update: false,
    date: null,
    help: false,
  };

  if (argv.length === 0) {
    result.help = true;
    return result;
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;

    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }

    if (arg === '--update') {
      result.update = true;
      continue;
    }

    if (arg === '--source') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`Flag --source requires a value`);
      }
      result.source = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--source=')) {
      result.source = arg.slice('--source='.length);
      continue;
    }

    if (arg === '--thumbnail-url') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`Flag --thumbnail-url requires a value`);
      }
      result.thumbnailUrl = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--thumbnail-url=')) {
      result.thumbnailUrl = arg.slice('--thumbnail-url='.length);
      continue;
    }

    if (arg === '--date') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`Flag --date requires a value`);
      }
      result.date = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--date=')) {
      result.date = arg.slice('--date='.length);
      continue;
    }

    throw new UsageError(`Unknown flag: ${arg}`);
  }

  return result;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

class IoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IoError';
  }
}

class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateIsoDate(raw: string): string {
  // Require strict ISO-8601 with timezone designator (Z or +/-HH:MM). This
  // matches the catalog's `publishedAt` validator in src/catalog/types.ts.
  const isoRegex =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!isoRegex.test(raw)) {
    throw new UsageError(
      `Invalid --date: "${raw}" is not a valid ISO-8601 timestamp (expected e.g. 2026-05-22T12:00:00Z)`,
    );
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new UsageError(`Invalid --date: "${raw}" is not a parseable timestamp`);
  }
  // Normalise to a canonical ISO string (with milliseconds, UTC).
  return parsed.toISOString();
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Atomic write: open `<dest>.tmp`, write the buffer, fsync, close, rename
 * over `<dest>`. Mirrors the protocol used by CatalogStore.atomicWrite.
 */
async function atomicWriteFile(destPath: string, data: Buffer): Promise<void> {
  const tmpPath = `${destPath}.tmp`;
  const handle = await open(tmpPath, 'w');
  try {
    await handle.write(data, 0, data.length, 0);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmpPath, destPath);
  } catch (cause) {
    // Best-effort cleanup of the tmp file before rethrowing.
    try {
      await unlink(tmpPath);
    } catch {
      /* ignore */
    }
    throw cause;
  }
}

function toProjectRelative(absPath: string, cwd: string): string {
  const rel = path.relative(cwd, absPath);
  if (rel.length === 0) return '.';
  // If outside cwd, keep the absolute path.
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return absPath;
  }
  // Normalise to forward slashes for portability of catalog.json across OSes.
  return rel.split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(argv: readonly string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n\n${USAGE}`);
      return 1;
    }
    throw err;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (args.source.length === 0) {
    process.stderr.write(`Missing required flag: --source\n\n${USAGE}`);
    return 1;
  }

  // --date validation (do this BEFORE loading config so user errors are
  // exit 1, distinct from IO and conflict).
  let cliPublishedAt: string | null = null;
  if (args.date !== null) {
    try {
      cliPublishedAt = validateIsoDate(args.date);
    } catch (err) {
      if (err instanceof UsageError) {
        process.stderr.write(`${err.message}\n`);
        return 1;
      }
      throw err;
    }
  }

  // 1. Load config (throws if env vars missing — no fallbacks).
  const config = loadConfig();

  // 2. Resolve source path to absolute; assert existence.
  const absSource = path.resolve(process.cwd(), args.source);
  if (!existsSync(absSource)) {
    process.stderr.write(`IO_ERROR: source file not found: ${absSource}\n`);
    return 2;
  }
  const sourceStat = statSync(absSource);
  if (!sourceStat.isFile()) {
    process.stderr.write(`IO_ERROR: source path is not a regular file: ${absSource}\n`);
    return 2;
  }

  // 3. Single buffered read.
  let buffer: Buffer;
  try {
    buffer = readFileSync(absSource);
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`IO_ERROR: failed to read source file ${absSource}: ${msg}\n`);
    return 2;
  }

  // 4. Extract metadata.
  let title: string;
  let extractedThumbnail: string | null;
  try {
    const meta = extractArticleMetadata(buffer);
    title = meta.title;
    extractedThumbnail = meta.thumbnailUrl;
  } catch (err) {
    if (err instanceof ArticleMetadataError) {
      process.stderr.write(`EXTRACTION_ERROR(${err.code}): ${err.message}\n`);
      return 1;
    }
    throw err;
  }

  // 5. Resolve final thumbnail URL + source.
  let thumbnailUrl: string;
  let thumbnailSource: 'html' | 'cli-override';
  if (extractedThumbnail !== null) {
    thumbnailUrl = extractedThumbnail;
    thumbnailSource = 'html';
  } else if (args.thumbnailUrl !== null && args.thumbnailUrl.length > 0) {
    thumbnailUrl = args.thumbnailUrl;
    thumbnailSource = 'cli-override';
  } else {
    process.stderr.write(
      `NO_THUMBNAIL: Article has no <img> and no --thumbnail-url provided\n`,
    );
    return 1;
  }

  // 6. Catalog load.
  const store = new CatalogStore(config.catalogPath);
  try {
    await store.load();
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`IO_ERROR: failed to load catalog: ${msg}\n`);
    return 2;
  }

  // Compute the absolute articles dir, and the project-relative source path
  // (we store sourcePath as project-relative when the file lies under cwd,
  // otherwise we store its absolute path).
  const absArticlesDir = path.resolve(process.cwd(), config.articlesDir);
  const sourcePathForCatalog = toProjectRelative(absSource, process.cwd());

  // 7. Slug resolution.
  let slug: string;
  let publishedAt: string;
  let existingEntry: CatalogEntry | null = null;
  const isUpdate = args.update;

  if (isUpdate) {
    // Locate existing entry: first by candidate slug (slugify with empty
    // taken-set so we get the bare base slug), then by sourcePath.
    let baseSlug: string;
    try {
      baseSlug = slugify(title, new Set<string>());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`USER_ERROR: cannot derive slug from title: ${msg}\n`);
      return 1;
    }

    existingEntry = store.getBySlug(baseSlug);
    if (existingEntry === null) {
      // Try matching by sourcePath (both project-relative and absolute forms).
      const snapshot = store.snapshot();
      const match = snapshot.find(
        (e) =>
          e.sourcePath === sourcePathForCatalog ||
          e.sourcePath === absSource,
      );
      existingEntry = match ? { ...match } : null;
    }

    if (existingEntry === null) {
      process.stderr.write(
        `UPDATE_TARGET_NOT_FOUND: no catalog entry matches title "${title}" or sourcePath "${sourcePathForCatalog}"\n`,
      );
      return 3;
    }

    slug = existingEntry.slug;
    publishedAt = existingEntry.publishedAt;
  } else {
    // New publish.
    const taken = store.existingSlugs();
    let baseSlug: string;
    try {
      baseSlug = slugify(title, new Set<string>());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`USER_ERROR: cannot derive slug from title: ${msg}\n`);
      return 1;
    }

    // Conflict check: if base slug is taken AND its existing entry has the
    // same title → ALREADY_PUBLISHED. Otherwise allow slugify() to produce a
    // suffixed slug.
    if (taken.has(baseSlug)) {
      const collidingEntry = store.getBySlug(baseSlug);
      if (collidingEntry !== null && collidingEntry.title === title) {
        process.stderr.write(
          `ALREADY_PUBLISHED: ${collidingEntry.slug}. Use --update to replace.\n`,
        );
        return 3;
      }
    }

    try {
      slug = slugify(title, taken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`USER_ERROR: cannot derive slug from title: ${msg}\n`);
      return 1;
    }

    publishedAt = cliPublishedAt !== null ? cliPublishedAt : new Date().toISOString();
  }

  // 8. Atomic byte-identical write of the article file.
  const targetPath = path.join(absArticlesDir, `${slug}.html`);
  try {
    await atomicWriteFile(targetPath, buffer);
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`IO_ERROR: failed to write article file ${targetPath}: ${msg}\n`);
    return 2;
  }

  // 9. SHA-256.
  const sha256 = sha256Hex(buffer);

  // 9b. YouTube enrichment (soft-skip on any failure path).
  // Policy: try to fetch `youtubePublishedAt` from the YouTube Data API when
  // the thumbnail URL resolves to a video AND `YOUTUBE_API_KEY` is set. Any
  // failure (no API key, non-YouTube URL, deleted video, network/HTTP error)
  // results in a one-line stderr note and the entry is persisted without the
  // optional field. This is feature gating, not a configuration fallback —
  // the rest of the system never substitutes missing config values.
  let youtubePublishedAt: string | undefined;
  const videoId = extractYouTubeVideoId(thumbnailUrl);
  if (videoId === null) {
    // Thumbnail is not a YouTube URL (e.g. --thumbnail-url pointing elsewhere).
    // Silent skip — nothing to enrich.
  } else {
    const apiKey = process.env['YOUTUBE_API_KEY'];
    if (apiKey === undefined || apiKey.length === 0) {
      process.stderr.write(
        `YOUTUBE_ENRICH_SKIPPED: YOUTUBE_API_KEY is not set; storing entry without youtubePublishedAt for video ${videoId}\n`,
      );
    } else {
      try {
        youtubePublishedAt = await fetchYouTubeVideoPublishedAt(videoId, apiKey);
      } catch (err) {
        const code = err instanceof YouTubeFetchError ? err.code : 'UNKNOWN';
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `YOUTUBE_ENRICH_FAILED(${code}): ${msg}; storing entry without youtubePublishedAt for video ${videoId}\n`,
        );
      }
    }
  }

  // 10. Build catalog entry.
  const articlePath = `articles/${slug}.html`;
  const entry: CatalogEntry = {
    slug,
    title,
    publishedAt,
    sourcePath: sourcePathForCatalog,
    articlePath,
    thumbnailUrl,
    thumbnailSource,
    sha256,
    ...(youtubePublishedAt !== undefined ? { youtubePublishedAt } : {}),
  };

  // 11. Persist via store.
  try {
    if (isUpdate) {
      await store.updateBySlug(slug, {
        title: entry.title,
        sourcePath: entry.sourcePath,
        articlePath: entry.articlePath,
        thumbnailUrl: entry.thumbnailUrl,
        thumbnailSource: entry.thumbnailSource,
        sha256: entry.sha256,
        ...(youtubePublishedAt !== undefined ? { youtubePublishedAt } : {}),
      });
    } else {
      await store.append(entry);
    }
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    // Could be a conflict (duplicate slug) or an IO write failure. The store
    // throws "already exists" for duplicate slug.
    if (msg.includes('already exists')) {
      process.stderr.write(`CONFLICT: ${msg}\n`);
      return 3;
    }
    process.stderr.write(`IO_ERROR: failed to persist catalog: ${msg}\n`);
    return 2;
  }

  // 12. One-line JSON summary.
  process.stdout.write(`${JSON.stringify(entry)}\n`);
  return 0;
}

// Entry point — only run when invoked directly (i.e. as the CLI).
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  (typeof process.argv[1] === 'string' &&
    import.meta.url.endsWith(path.basename(process.argv[1])));

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      process.stderr.write(`UNEXPECTED_ERROR: ${msg}\n`);
      process.exit(1);
    });
}

export { main, parseArgs };
