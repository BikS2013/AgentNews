/**
 * Catalog data model and runtime validators.
 *
 * The catalog is persisted as a flat JSON file at the path given by
 * `CATALOG_PATH` (see `src/config.ts`). The schema version is locked to `1`
 * for v1 of the publishing site.
 */

export interface CatalogEntry {
  /** kebab-case identifier, frozen at publish time. */
  slug: string;
  /** Human-readable title, extracted from `<title>`. */
  title: string;
  /** ISO-8601 UTC publication timestamp. */
  publishedAt: string;
  /** Absolute or project-relative path to the original source HTML. */
  sourcePath: string;
  /** Project-relative path under `articles/`, e.g. `"articles/foo.html"`. */
  articlePath: string;
  /** Thumbnail URL displayed on the catalog page. */
  thumbnailUrl: string;
  /** Where the thumbnail came from. */
  thumbnailSource: 'html' | 'cli-override';
  /** Lower-case hexadecimal SHA-256 of the published HTML file (64 chars). */
  sha256: string;
  /**
   * Optional ISO-8601 UTC timestamp of when the underlying YouTube video was
   * published. Populated at publish time by `publish-article` when the
   * thumbnail URL resolves to a YouTube video AND `YOUTUBE_API_KEY` is set;
   * omitted otherwise (soft-skip — see `src/extractor/youtube.ts`).
   */
  youtubePublishedAt?: string;
  /**
   * Optional category placing the entry into one of the homepage lists.
   * - `deep-dive` (default when absent) — technical AI video deep dives.
   * - `ai-news`                         — accessible AI news videos that
   *                                       belong in the mixed "AI-News"
   *                                       homepage list alongside non-video
   *                                       AI-News links.
   */
  category?: ExperimentalCatalogCategory;
}

/** Discriminator for the homepage list a CatalogEntry belongs to (PUBLIC flow). */
export type CatalogCategory = 'deep-dive' | 'ai-news';

/**
 * Category union for the EXPERIMENTAL flow only. Includes every public
 * category plus 'tools'. The runtime store validates against either set
 * depending on which flow constructed it.
 */
export type ExperimentalCatalogCategory = CatalogCategory | 'tools';

/** Default category used when an entry omits the field on disk. */
export const DEFAULT_CATALOG_CATEGORY: CatalogCategory = 'deep-dive';

/** Allowed `category` values in the PUBLIC flow (CLI parsing + on-disk validation). */
export const CATALOG_CATEGORIES: readonly CatalogCategory[] = [
  'deep-dive',
  'ai-news',
];

/** Allowed `category` values in the EXPERIMENTAL flow (CLI parsing + on-disk validation). */
export const EXPERIMENTAL_CATALOG_CATEGORIES: readonly ExperimentalCatalogCategory[] = [
  'deep-dive',
  'ai-news',
  'tools',
];

export interface CatalogFile {
  schemaVersion: 1;
  entries: CatalogEntry[];
  updatedAt: string;
}

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SHA256_REGEX = /^[a-f0-9]{64}$/;
const ISO_8601_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_8601_REGEX.test(value);
}

export function isCatalogEntry(
  value: unknown,
  allowedCategories: readonly string[] = CATALOG_CATEGORIES,
): value is CatalogEntry {
  if (!isObject(value)) return false;

  if (!isNonEmptyString(value['slug'])) return false;
  if (!SLUG_REGEX.test(value['slug'])) return false;

  if (!isNonEmptyString(value['title'])) return false;

  if (!isIsoTimestamp(value['publishedAt'])) return false;

  if (!isNonEmptyString(value['sourcePath'])) return false;
  if (!isNonEmptyString(value['articlePath'])) return false;
  if (!isNonEmptyString(value['thumbnailUrl'])) return false;

  const ts = value['thumbnailSource'];
  if (ts !== 'html' && ts !== 'cli-override') return false;

  if (typeof value['sha256'] !== 'string') return false;
  if (!SHA256_REGEX.test(value['sha256'])) return false;

  // Optional field: youtubePublishedAt. If present, must be an ISO-8601
  // timestamp. If absent (undefined or key missing), accept silently.
  const yt = value['youtubePublishedAt'];
  if (yt !== undefined && !isIsoTimestamp(yt)) return false;

  // Optional field: category. If present, must be one of the allowed values
  // for the calling flow (public: CATALOG_CATEGORIES; experimental:
  // EXPERIMENTAL_CATALOG_CATEGORIES).
  const cat = value['category'];
  if (cat !== undefined && !allowedCategories.includes(cat as string)) {
    return false;
  }

  return true;
}

export function isCatalogFile(
  value: unknown,
  allowedCategories: readonly string[] = CATALOG_CATEGORIES,
): value is CatalogFile {
  if (!isObject(value)) return false;
  if (value['schemaVersion'] !== 1) return false;
  if (!isIsoTimestamp(value['updatedAt'])) return false;
  const entries = value['entries'];
  if (!Array.isArray(entries)) return false;
  for (const entry of entries) {
    if (!isCatalogEntry(entry, allowedCategories)) return false;
  }
  return true;
}
