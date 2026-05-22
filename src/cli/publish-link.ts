#!/usr/bin/env node
/**
 * publish-link CLI
 *
 * Adds a third-party article URL to the Agent News catalog. Fetches the
 * source page, extracts Open Graph / Twitter-card metadata, and appends a
 * `LinkEntry` to the file at `LINKS_PATH`. CLI flags override any extracted
 * field. Exit codes mirror `publish-article`:
 *
 *   0 — success
 *   1 — user/argument error (bad flag, missing required, invalid date)
 *   2 — IO error (links file write failure)
 *   3 — conflict (link already exists with same URL or id; --update missing)
 *
 * No fallback configuration values are ever substituted — missing env vars
 * cause `loadConfig()` to throw.
 */

import * as path from 'node:path';
import * as process from 'node:process';

import { loadConfig } from '../config.js';
import {
  fetchLinkMetadata,
  idify,
  LinkMetadataError,
} from '../extractor/link-metadata.js';
import { LinksStore } from '../links/store.js';
import type { LinkEntry } from '../links/types.js';

// ---------------------------------------------------------------------------
// argv parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  url: string;
  title: string | null;
  imageUrl: string | null;
  summary: string | null;
  sourceSite: string | null;
  date: string | null;
  update: boolean;
  help: boolean;
}

const USAGE = `Usage: publish-link --url <URL> [options]

Required:
  --url <URL>               Absolute http(s) URL of the source article.

Options (override the auto-extracted value from the source page's meta tags):
  --title <text>            Article title.
  --image-url <URL>         Absolute image URL.
  --summary <text>          Short summary / description.
  --source-site <host>      Override the displayed source site (default: URL host).
  --date <ISO-8601>         Publication timestamp (defaults to now).
  --update                  Replace an existing entry whose URL matches.
  --help                    Show this help and exit 0.

Exit codes:
  0 success, 1 user error, 2 IO error, 3 conflict.
`;

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = {
    url: '',
    title: null,
    imageUrl: null,
    summary: null,
    sourceSite: null,
    date: null,
    update: false,
    help: false,
  };
  if (argv.length === 0) {
    result.help = true;
    return result;
  }

  const flag = (name: string, target: keyof ParsedArgs) => {
    return (i: number): number => {
      const arg = argv[i];
      if (arg === `--${name}`) {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
          throw new UsageError(`Flag --${name} requires a value`);
        }
        (result as unknown as Record<string, unknown>)[target] = value;
        return i + 1;
      }
      if (arg !== undefined && arg.startsWith(`--${name}=`)) {
        (result as unknown as Record<string, unknown>)[target] = arg.slice(`--${name}=`.length);
        return i;
      }
      return -1;
    };
  };

  const handlers = [
    flag('url', 'url'),
    flag('title', 'title'),
    flag('image-url', 'imageUrl'),
    flag('summary', 'summary'),
    flag('source-site', 'sourceSite'),
    flag('date', 'date'),
  ];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === '--help' || arg === '-h') { result.help = true; continue; }
    if (arg === '--update') { result.update = true; continue; }

    let matched = false;
    for (const h of handlers) {
      const next = h(i);
      if (next !== -1) {
        i = next;
        matched = true;
        break;
      }
    }
    if (!matched) {
      throw new UsageError(`Unknown flag: ${arg}`);
    }
  }
  return result;
}

function validateIsoDate(raw: string): string {
  const isoRegex =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!isoRegex.test(raw)) {
    throw new UsageError(
      `Invalid --date: "${raw}" is not a valid ISO-8601 timestamp (e.g. 2026-05-22T12:00:00Z)`,
    );
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new UsageError(`Invalid --date: "${raw}" is not parseable`);
  }
  return parsed.toISOString();
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

  if (args.url.length === 0) {
    process.stderr.write(`Missing required flag: --url\n\n${USAGE}`);
    return 1;
  }
  try {
    const u = new URL(args.url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('not http/https');
    }
  } catch {
    process.stderr.write(`USER_ERROR: --url must be an absolute http(s) URL: ${args.url}\n`);
    return 1;
  }

  let cliDate: string | null = null;
  if (args.date !== null) {
    try {
      cliDate = validateIsoDate(args.date);
    } catch (err) {
      if (err instanceof UsageError) {
        process.stderr.write(`${err.message}\n`);
        return 1;
      }
      throw err;
    }
  }

  // Load config (throws if env vars missing).
  const config = loadConfig();

  // Try to fetch + extract metadata. If extraction fails, the CLI must
  // refuse to publish unless all required fields were provided explicitly.
  let extracted:
    | Awaited<ReturnType<typeof fetchLinkMetadata>>
    | null = null;
  let extractionError: LinkMetadataError | null = null;
  try {
    extracted = await fetchLinkMetadata(args.url);
  } catch (err) {
    if (err instanceof LinkMetadataError) {
      extractionError = err;
    } else {
      throw err;
    }
  }

  // Merge extraction with CLI overrides. Explicit flags win.
  const title = args.title ?? extracted?.title ?? null;
  const imageUrl = args.imageUrl ?? extracted?.imageUrl ?? null;
  const summary = args.summary ?? extracted?.summary ?? null;
  const sourceSite =
    args.sourceSite ?? extracted?.sourceSite ?? new URL(args.url).hostname;
  const finalUrl = extracted?.finalUrl ?? args.url;

  if (title === null || title.length === 0) {
    process.stderr.write(
      `NO_TITLE: source page provided no usable title and --title was not given${
        extractionError ? ` (extraction error: ${extractionError.message})` : ''
      }\n`,
    );
    return 1;
  }
  if (imageUrl === null || imageUrl.length === 0) {
    process.stderr.write(
      `NO_IMAGE: source page provided no usable image and --image-url was not given${
        extractionError ? ` (extraction error: ${extractionError.message})` : ''
      }\n`,
    );
    return 1;
  }

  // Load the links store.
  const store = new LinksStore(config.linksPath);
  try {
    await store.load();
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`IO_ERROR: failed to load links: ${msg}\n`);
    return 2;
  }

  // Check for duplicate URLs (regardless of id collisions).
  const existingByUrl = store.snapshot().find((e) => e.url === finalUrl);
  if (existingByUrl !== undefined && !args.update) {
    process.stderr.write(
      `ALREADY_PUBLISHED: link with url ${finalUrl} already exists (id="${existingByUrl.id}"). Use --update to replace.\n`,
    );
    return 3;
  }

  // Resolve id + publishedAt.
  let id: string;
  let publishedAt: string;
  if (existingByUrl !== undefined && args.update) {
    id = existingByUrl.id;
    publishedAt = existingByUrl.publishedAt;
  } else {
    try {
      id = idify(title, store.existingIds());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`USER_ERROR: cannot derive id from title: ${msg}\n`);
      return 1;
    }
    publishedAt = cliDate ?? new Date().toISOString();
  }

  const entry: LinkEntry = {
    id,
    title,
    url: finalUrl,
    imageUrl,
    sourceSite,
    publishedAt,
    ...(summary !== null && summary.length > 0 ? { summary } : {}),
  };

  try {
    if (existingByUrl !== undefined && args.update) {
      await store.updateById(id, {
        title: entry.title,
        url: entry.url,
        imageUrl: entry.imageUrl,
        sourceSite: entry.sourceSite,
        ...(summary !== null && summary.length > 0 ? { summary } : {}),
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
    process.stderr.write(`IO_ERROR: failed to persist links: ${msg}\n`);
    return 2;
  }

  process.stdout.write(`${JSON.stringify(entry)}\n`);
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  (typeof process.argv[1] === 'string' &&
    import.meta.url.endsWith(path.basename(process.argv[1])));

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => { process.exit(code); })
    .catch((err) => {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      process.stderr.write(`UNEXPECTED_ERROR: ${msg}\n`);
      process.exit(1);
    });
}

export { main, parseArgs };
