/**
 * Link metadata extractor.
 *
 * Given an external URL, fetches the page and pulls out the best-available
 * metadata for displaying it on the Agent News catalog: title, image URL,
 * and short summary. Used by the `publish-link` CLI to seed new
 * `LinkEntry` records.
 *
 * Extraction strategy (highest-priority first):
 *
 *   title:
 *     1. <meta property="og:title">
 *     2. <meta name="twitter:title">
 *     3. <title>
 *
 *   imageUrl:
 *     1. <meta property="og:image:secure_url">
 *     2. <meta property="og:image">
 *     3. <meta name="twitter:image">
 *     4. <meta name="twitter:image:src">
 *     5. <link rel="image_src">
 *     6. First <img src="..."> in document order
 *
 *   summary (optional — caller decides what to do if absent):
 *     1. <meta property="og:description">
 *     2. <meta name="twitter:description">
 *     3. <meta name="description">
 *
 * All URL values are resolved against the page's `<base href>` (if present)
 * or against the request URL, so relative `og:image` paths become absolute.
 */

import * as cheerio from 'cheerio';

export type LinkMetadataErrorCode =
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'EMPTY_BODY'
  | 'NO_TITLE'
  | 'NO_IMAGE'
  | 'INVALID_URL';

export class LinkMetadataError extends Error {
  constructor(
    public readonly code: LinkMetadataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LinkMetadataError';
  }
}

export interface LinkMetadata {
  /** Resolved title (non-empty). */
  title: string;
  /** Absolute URL of the representative image (non-empty, http/https). */
  imageUrl: string;
  /** Optional short description (absent → undefined). */
  summary?: string;
  /** Bare hostname of the source URL — e.g. "www.anthropic.com". */
  sourceSite: string;
  /** The final URL after any HTTP redirects (caller may want to store this). */
  finalUrl: string;
}

/**
 * Fetch the given URL and extract Open-Graph / Twitter-card / fallback
 * metadata. Throws `LinkMetadataError` on every failure path — the CLI
 * decides whether to abort or accept user overrides.
 *
 * @param url        Absolute http(s) URL of the source article.
 * @param fetchImpl  Optional fetch implementation (for testing). Defaults
 *                   to the global `fetch`.
 */
export async function fetchLinkMetadata(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LinkMetadata> {
  let parsedRequest: URL;
  try {
    parsedRequest = new URL(url);
  } catch {
    throw new LinkMetadataError('INVALID_URL', `Not a valid absolute URL: "${url}"`);
  }
  if (parsedRequest.protocol !== 'http:' && parsedRequest.protocol !== 'https:') {
    throw new LinkMetadataError(
      'INVALID_URL',
      `URL must be http or https (got "${parsedRequest.protocol}")`,
    );
  }

  let response: Response;
  try {
    response = await fetchImpl(parsedRequest, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        // Some sites refuse default fetch user-agent; identify as a generic
        // crawler. Accept HTML; we cannot reliably parse non-HTML pages.
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent':
          'AgentNewsBot/1.0 (+https://biks2013.github.io/AgentNews/) Mozilla/5.0',
      },
    });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw new LinkMetadataError(
      'NETWORK_ERROR',
      `Network failure fetching ${url}: ${msg}`,
    );
  }

  if (!response.ok) {
    let bodyText = '';
    try {
      bodyText = (await response.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    throw new LinkMetadataError(
      'HTTP_ERROR',
      `Source returned ${response.status} ${response.statusText} for ${url}${
        bodyText.length > 0 ? `: ${bodyText}` : ''
      }`,
    );
  }

  const finalUrl = response.url || url;
  const html = await response.text();
  if (html.length === 0) {
    throw new LinkMetadataError('EMPTY_BODY', `Empty response body for ${url}`);
  }

  const $ = cheerio.load(html);

  // Resolve relative URLs against <base href> if present, else final URL.
  const baseHref = $('base[href]').first().attr('href');
  const baseUrl = baseHref !== undefined ? new URL(baseHref, finalUrl).href : finalUrl;

  // ------------------------------ TITLE -------------------------------------
  const title =
    meta($, 'property', 'og:title') ??
    meta($, 'name', 'twitter:title') ??
    $('title').first().text().trim();

  if (!title || title.length === 0) {
    throw new LinkMetadataError('NO_TITLE', `Page at ${url} has no usable title`);
  }

  // ------------------------------ IMAGE -------------------------------------
  const rawImage =
    meta($, 'property', 'og:image:secure_url') ??
    meta($, 'property', 'og:image') ??
    meta($, 'name', 'twitter:image') ??
    meta($, 'name', 'twitter:image:src') ??
    $('link[rel="image_src"]').first().attr('href') ??
    $('img[src]').first().attr('src') ??
    null;

  if (rawImage === null || rawImage.length === 0) {
    throw new LinkMetadataError('NO_IMAGE', `Page at ${url} has no usable image`);
  }

  let absoluteImage: string;
  try {
    absoluteImage = new URL(rawImage, baseUrl).href;
  } catch {
    throw new LinkMetadataError(
      'NO_IMAGE',
      `Page at ${url} returned an unparseable image URL: "${rawImage}"`,
    );
  }
  if (!/^https?:/i.test(absoluteImage)) {
    throw new LinkMetadataError(
      'NO_IMAGE',
      `Resolved image URL is not http/https: "${absoluteImage}"`,
    );
  }

  // ----------------------------- SUMMARY ------------------------------------
  const rawSummary =
    meta($, 'property', 'og:description') ??
    meta($, 'name', 'twitter:description') ??
    meta($, 'name', 'description') ??
    null;
  const summary = rawSummary === null ? undefined : rawSummary;

  // --------------------------- SOURCE SITE ----------------------------------
  const sourceSite = new URL(finalUrl).hostname;

  return {
    title: title.trim(),
    imageUrl: absoluteImage,
    ...(summary !== undefined ? { summary: summary.trim() } : {}),
    sourceSite,
    finalUrl,
  };
}

/**
 * Read a single `<meta>` tag identified by attribute name + value. Returns
 * the trimmed `content` attribute, or `null` if no matching tag exists.
 */
function meta(
  $: cheerio.CheerioAPI,
  attr: 'property' | 'name',
  value: string,
): string | null {
  const el = $(`meta[${attr}="${value}"]`).first();
  if (el.length === 0) return null;
  const content = el.attr('content');
  if (content === undefined) return null;
  const trimmed = content.trim();
  if (trimmed.length === 0) return null;
  return trimmed;
}

/**
 * Build a kebab-case id from a title, with sequential suffix on collision.
 * Mirrors `src/catalog/slug.ts` but exposed under the links namespace so
 * the two stores can evolve independently if needed.
 */
export function idify(title: string, taken: ReadonlySet<string>): string {
  const base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (base.length === 0) {
    throw new Error(`Cannot derive id from title: "${title}"`);
  }
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
