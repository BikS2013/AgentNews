/**
 * External-link entries — third-party articles the site curates and links to
 * (the link opens in a new tab; the article itself is hosted by its
 * original publisher). Stored in the file at `LINKS_PATH` (defaults
 * convention: `data/links.json`).
 *
 * Schema is independent from the video-deep-dive `CatalogEntry` schema in
 * `src/catalog/types.ts`. They share no fields beyond `publishedAt`.
 */

export interface LinkEntry {
  /** Stable kebab-case identifier, derived from title at publish time. */
  id: string;
  /** Headline as it appears on the source page. */
  title: string;
  /** Absolute URL to the source article. Opens in a new tab. */
  url: string;
  /**
   * Absolute URL to the visual that represents the article in the catalog
   * (og:image, twitter:image, or first <img> from the source page).
   */
  imageUrl: string;
  /** Optional short summary (og:description / meta description). */
  summary?: string;
  /** Bare hostname of `url`, e.g. `"www.anthropic.com"`. */
  sourceSite: string;
  /** ISO-8601 UTC timestamp of when the link was added to the catalog. */
  publishedAt: string;
  /**
   * Optional category placing the entry into one of the homepage lists.
   * - `article` (default when absent) — curated technical/general AI articles
   *                                     in the "Articles" list.
   * - `ai-news`                       — non-technical AI news links that
   *                                     belong in the mixed "AI-News" list
   *                                     alongside AI-News videos.
   */
  category?: LinkCategory;
}

/** Discriminator for the homepage list a LinkEntry belongs to. */
export type LinkCategory = 'article' | 'ai-news';

/** Default category used when an entry omits the field on disk. */
export const DEFAULT_LINK_CATEGORY: LinkCategory = 'article';

/** Allowed `category` values for runtime validation + CLI parsing. */
export const LINK_CATEGORIES: readonly LinkCategory[] = ['article', 'ai-news'];

export interface LinksFile {
  schemaVersion: 1;
  entries: LinkEntry[];
  updatedAt: string;
}

const ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
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

function isAbsoluteHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isLinkEntry(value: unknown): value is LinkEntry {
  if (!isObject(value)) return false;

  if (!isNonEmptyString(value['id'])) return false;
  if (!ID_REGEX.test(value['id'])) return false;

  if (!isNonEmptyString(value['title'])) return false;

  if (!isAbsoluteHttpUrl(value['url'])) return false;
  if (!isAbsoluteHttpUrl(value['imageUrl'])) return false;

  if (!isNonEmptyString(value['sourceSite'])) return false;

  if (!isIsoTimestamp(value['publishedAt'])) return false;

  const sum = value['summary'];
  if (sum !== undefined && (typeof sum !== 'string' || sum.length === 0)) return false;

  // Optional field: category. If present, must be one of the allowed values.
  const cat = value['category'];
  if (cat !== undefined && !LINK_CATEGORIES.includes(cat as LinkCategory)) {
    return false;
  }

  return true;
}

export function isLinksFile(value: unknown): value is LinksFile {
  if (!isObject(value)) return false;
  if (value['schemaVersion'] !== 1) return false;
  if (!isIsoTimestamp(value['updatedAt'])) return false;
  const entries = value['entries'];
  if (!Array.isArray(entries)) return false;
  for (const entry of entries) {
    if (!isLinkEntry(entry)) return false;
  }
  return true;
}
