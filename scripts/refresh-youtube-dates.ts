#!/usr/bin/env tsx
/**
 * Refresh YouTube upload dates in the catalog.
 *
 * Reads every entry from `CATALOG_PATH`, extracts the YouTube video ID from
 * the entry's `thumbnailUrl`, and — depending on mode — either:
 *
 *   - Backfills `youtubePublishedAt` for entries that are missing it
 *     (default mode). Useful when an article was added directly via git
 *     (PR merge) rather than via the `publish-article` CLI, since the CLI
 *     is the only place that calls the YouTube Data API today.
 *
 *   - With `--all`, re-fetches the date for EVERY entry whose thumbnail
 *     resolves to a YouTube video, even if `youtubePublishedAt` already
 *     exists. Useful when a video's metadata is suspected stale or when
 *     an entry's thumbnail/video ID changed.
 *
 * Entries whose thumbnail is NOT a YouTube URL are silently skipped — no
 * `youtubePublishedAt` is recorded (matching the publish-article behaviour).
 *
 * Writes the updated catalog atomically through `CatalogStore.updateBySlug`
 * so slug and `publishedAt` (site-publish date) are immutable.
 *
 * Required env vars (no fallbacks):
 *   CATALOG_PATH      — path to data/catalog.json
 *   YOUTUBE_API_KEY   — YouTube Data API v3 key
 *
 * Exit codes:
 *   0 — success (all updates applied, or nothing to update)
 *   1 — user / argument error or missing env var
 *   2 — IO error reading/writing the catalog
 *   3 — at least one YouTube fetch failed (other entries may still have been updated)
 */

import * as process from 'node:process';

import { CatalogStore } from '../src/catalog/store.js';
import {
  extractYouTubeVideoId,
  fetchYouTubeVideoPublishedAt,
  YouTubeFetchError,
} from '../src/extractor/youtube.js';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

interface ParsedArgs {
  all: boolean;
  help: boolean;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = { all: false, help: false };
  for (const arg of argv) {
    if (arg === '--all') result.all = true;
    else if (arg === '--help' || arg === '-h') result.help = true;
    else throw new Error(`Unknown flag: ${arg}`);
  }
  return result;
}

const USAGE = `Usage: refresh-youtube-dates [--all]

Default mode: backfill youtubePublishedAt for entries that are missing it.
--all       : re-fetch the date for every entry whose thumbnail is a YouTube URL.

Required env vars:
  CATALOG_PATH       Path to the catalog JSON file.
  YOUTUBE_API_KEY    YouTube Data API v3 key.
`;

async function main(argv: readonly string[]): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
    return 1;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  let catalogPath: string;
  let apiKey: string;
  try {
    catalogPath = requireEnv('CATALOG_PATH');
    apiKey = requireEnv('YOUTUBE_API_KEY');
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const store = new CatalogStore(catalogPath);
  try {
    await store.load();
  } catch (cause) {
    process.stderr.write(
      `IO_ERROR: failed to load catalog: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 2;
  }

  const snapshot = store.snapshot();
  let attempted = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of snapshot) {
    const videoId = extractYouTubeVideoId(entry.thumbnailUrl);
    if (videoId === null) {
      process.stdout.write(`skip (non-YouTube thumbnail): ${entry.slug}\n`);
      skipped += 1;
      continue;
    }

    const hasYt = entry.youtubePublishedAt !== undefined;
    if (hasYt && !args.all) {
      process.stdout.write(`skip (already set):           ${entry.slug}  ->  ${entry.youtubePublishedAt}\n`);
      skipped += 1;
      continue;
    }

    attempted += 1;
    try {
      const youtubePublishedAt = await fetchYouTubeVideoPublishedAt(videoId, apiKey);
      const previous = entry.youtubePublishedAt;
      if (previous === youtubePublishedAt) {
        process.stdout.write(`unchanged:                    ${entry.slug}  ->  ${youtubePublishedAt}\n`);
      } else {
        await store.updateBySlug(entry.slug, { youtubePublishedAt });
        const change = previous === undefined ? '(was missing)' : `(was ${previous})`;
        process.stdout.write(`updated:                      ${entry.slug}  ->  ${youtubePublishedAt}  ${change}\n`);
        updated += 1;
      }
    } catch (err) {
      failed += 1;
      const code = err instanceof YouTubeFetchError ? err.code : 'UNKNOWN';
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`FAIL (${code}):                ${entry.slug}  videoId=${videoId}  ${msg}\n`);
    }
  }

  process.stdout.write(
    `\nSummary: ${attempted} attempted, ${updated} updated, ${skipped} skipped, ${failed} failed.\n`,
  );

  if (failed > 0) return 3;
  return 0;
}

main(process.argv.slice(2))
  .then((code) => { process.exit(code); })
  .catch((err) => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`UNEXPECTED_ERROR: ${msg}\n`);
    process.exit(1);
  });
