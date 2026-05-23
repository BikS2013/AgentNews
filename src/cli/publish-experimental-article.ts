#!/usr/bin/env node
/**
 * publish-experimental-article CLI
 *
 * Mirrors `publish-article` but writes EXCLUSIVELY to the experimental sibling
 * pipeline: source HTML is copied byte-identically into
 * `<EXPERIMENTAL_DIR>/<slug>.html`, the SHA-256 is computed, and a
 * CatalogEntry is appended (or updated, with --update) to
 * `<EXPERIMENTAL_CATALOG_PATH>`.
 *
 * Single-writer guarantee:
 *   This CLI refuses to run unless EXPERIMENTAL_DIR's basename is exactly
 *   "experimental" AND EXPERIMENTAL_CATALOG_PATH's basename begins with
 *   "experimental-". Any attempt to point it at `articles/` or
 *   `data/catalog.json` is rejected with UsageError (exit 1) before any
 *   file is touched. This is the structural guard that keeps experimental
 *   content out of the public flow.
 *
 * Exit codes:
 *   0 — success
 *   1 — user/argument error (bad flag, missing required, no thumbnail, invalid date, target-path guard)
 *   2 — IO error (source not found, write failed)
 *   3 — conflict (already published without --update; --update target not found)
 *
 * No fallback configuration values are ever substituted — missing env vars
 * cause the CLI to throw at startup.
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
import {
  EXPERIMENTAL_CATALOG_CATEGORIES,
  type CatalogEntry,
  type ExperimentalCatalogCategory,
} from '../catalog/types.js';
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
  category: ExperimentalCatalogCategory | null;
  help: boolean;
}

const USAGE = `Usage: publish-experimental-article --source <path> [options]

Required:
  --source <path>           Path to the source HTML article to publish into
                            the experimental sibling site.

Options:
  --thumbnail-url <url>     Override thumbnail URL (used only when the article
                            has no <img>).
  --update                  Replace an already-published experimental article
                            (preserves slug and publishedAt; updates file +
                            sha256 + thumbnail + sourcePath).
  --date <ISO-8601>         Publication timestamp (defaults to now, ignored
                            on --update).
  --category <name>         Homepage list to place the entry in:
                              deep-dive (default) — technical AI videos.
                              ai-news             — non-technical AI news.
                              tools               — tools / utilities
                                                    (EXPERIMENTAL-only category;
                                                    rejected by publish-article).
  --help                    Show this help and exit 0.

Required environment variables (no defaults — missing = fatal):
  EXPERIMENTAL_DIR            Must resolve to a directory whose basename is
                              exactly "experimental".
  EXPERIMENTAL_CATALOG_PATH   Must resolve to a JSON file whose basename
                              starts with "experimental-".

Exit codes:
  0 success, 1 user error, 2 IO error, 3 conflict.
`;

function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = {
    source: '',
    thumbnailUrl: null,
    update: false,
    date: null,
    category: null,
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

    if (arg === '--category') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`Flag --category requires a value`);
      }
      result.category = parseCategory(value);
      i += 1;
      continue;
    }

    if (arg.startsWith('--category=')) {
      result.category = parseCategory(arg.slice('--category='.length));
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

function parseCategory(raw: string): ExperimentalCatalogCategory {
  if (!EXPERIMENTAL_CATALOG_CATEGORIES.includes(raw as ExperimentalCatalogCategory)) {
    throw new UsageError(
      `Invalid --category: "${raw}". Allowed values: ${EXPERIMENTAL_CATALOG_CATEGORIES.join(', ')}`,
    );
  }
  return raw as ExperimentalCatalogCategory;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === null) {
    throw new Error(`Missing required env var: ${name}`);
  }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error(`Required env var ${name} must not be empty`);
  }
  return raw.trim();
}

/**
 * Load experimental-only configuration directly from env. Deliberately does
 * NOT reuse `loadConfig()` from `src/config.ts` — that loader is scoped to
 * the public server flow (PORT, ARTICLES_DIR, CATALOG_PATH, LINKS_PATH) and
 * mixing the two would violate the single-writer guarantee.
 */
interface ExperimentalConfig {
  experimentalDir: string;
  experimentalCatalogPath: string;
}

function loadExperimentalConfig(): ExperimentalConfig {
  return {
    experimentalDir: requireEnv('EXPERIMENTAL_DIR'),
    experimentalCatalogPath: requireEnv('EXPERIMENTAL_CATALOG_PATH'),
  };
}

/**
 * Single-writer guard. The CLI must NEVER touch the public articles tree or
 * the public catalog manifest. This check runs BEFORE any filesystem write.
 */
function assertExperimentalTargets(cfg: ExperimentalConfig): void {
  const dirBase = path.basename(path.resolve(process.cwd(), cfg.experimentalDir));
  if (dirBase !== 'experimental') {
    throw new UsageError(
      `EXPERIMENTAL_DIR must resolve to a directory whose basename is exactly "experimental" (got "${dirBase}" from "${cfg.experimentalDir}"). Refusing to write into a non-experimental tree.`,
    );
  }
  const catalogBase = path.basename(
    path.resolve(process.cwd(), cfg.experimentalCatalogPath),
  );
  if (!catalogBase.startsWith('experimental-')) {
    throw new UsageError(
      `EXPERIMENTAL_CATALOG_PATH must resolve to a file whose basename starts with "experimental-" (got "${catalogBase}" from "${cfg.experimentalCatalogPath}"). Refusing to write into a non-experimental manifest.`,
    );
  }
}

function validateIsoDate(raw: string): string {
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
  return parsed.toISOString();
}

function sha256Hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

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
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return absPath;
  }
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

  // 1. Load experimental-only config (throws on missing env vars).
  const config = loadExperimentalConfig();

  // 2. Single-writer guard: refuse to point at the public tree/manifest.
  try {
    assertExperimentalTargets(config);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      return 1;
    }
    throw err;
  }

  // 3. Resolve source path.
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

  // 4. Single buffered read.
  let buffer: Buffer;
  try {
    buffer = readFileSync(absSource);
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`IO_ERROR: failed to read source file ${absSource}: ${msg}\n`);
    return 2;
  }

  // 5. Extract metadata.
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

  // 6. Resolve final thumbnail URL + source.
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

  // 7. Catalog load (experimental manifest).
  //    Pass the wider allowed-category set so on-disk entries with
  //    category='tools' pass schema validation.
  const store = new CatalogStore(config.experimentalCatalogPath, {
    allowedCategories: EXPERIMENTAL_CATALOG_CATEGORIES,
  });
  try {
    await store.load();
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`IO_ERROR: failed to load experimental catalog: ${msg}\n`);
    return 2;
  }

  const absExperimentalDir = path.resolve(process.cwd(), config.experimentalDir);
  const sourcePathForCatalog = toProjectRelative(absSource, process.cwd());

  // 8. Slug resolution.
  let slug: string;
  let publishedAt: string;
  let existingEntry: CatalogEntry | null = null;
  const isUpdate = args.update;

  if (isUpdate) {
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
        `UPDATE_TARGET_NOT_FOUND: no experimental catalog entry matches title "${title}" or sourcePath "${sourcePathForCatalog}"\n`,
      );
      return 3;
    }

    slug = existingEntry.slug;
    publishedAt = existingEntry.publishedAt;
  } else {
    const taken = store.existingSlugs();
    let baseSlug: string;
    try {
      baseSlug = slugify(title, new Set<string>());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`USER_ERROR: cannot derive slug from title: ${msg}\n`);
      return 1;
    }

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

  // 9. Atomic byte-identical write of the experimental article file.
  const targetPath = path.join(absExperimentalDir, `${slug}.html`);
  try {
    await atomicWriteFile(targetPath, buffer);
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`IO_ERROR: failed to write article file ${targetPath}: ${msg}\n`);
    return 2;
  }

  // 10. SHA-256.
  const sha256 = sha256Hex(buffer);

  // 11. YouTube enrichment (soft-skip on any failure path; identical policy
  //     to publish-article).
  let youtubePublishedAt: string | undefined;
  const videoId = extractYouTubeVideoId(thumbnailUrl);
  if (videoId === null) {
    // Thumbnail is not a YouTube URL.
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

  // 12. Build catalog entry. articlePath uses the `experimental/` prefix.
  const articlePath = `experimental/${slug}.html`;
  let categoryToPersist: ExperimentalCatalogCategory | undefined;
  if (args.category !== null) {
    categoryToPersist = args.category;
  } else if (isUpdate && existingEntry !== null && existingEntry.category !== undefined) {
    categoryToPersist = existingEntry.category;
  }
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
    ...(categoryToPersist !== undefined ? { category: categoryToPersist } : {}),
  };

  // 13. Persist via store.
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
        ...(categoryToPersist !== undefined ? { category: categoryToPersist } : {}),
      });
    } else {
      await store.append(entry);
    }
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (msg.includes('already exists')) {
      process.stderr.write(`CONFLICT: ${msg}\n`);
      return 3;
    }
    process.stderr.write(`IO_ERROR: failed to persist experimental catalog: ${msg}\n`);
    return 2;
  }

  // 14. One-line JSON summary.
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
