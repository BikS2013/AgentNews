/**
 * YouTube metadata enrichment.
 *
 * Provides two pure helpers:
 *
 * 1. `extractYouTubeVideoId(url)` — parses a YouTube thumbnail or watch URL and
 *    returns the 11-character video ID, or `null` if the URL is not a
 *    recognised YouTube URL. No I/O.
 *
 * 2. `fetchYouTubeVideoPublishedAt(videoId, apiKey)` — calls the YouTube Data
 *    API v3 `videos.list` endpoint and returns the canonical `snippet.publishedAt`
 *    ISO-8601 timestamp. Throws `YouTubeFetchError` on any failure path
 *    (network, non-200, video deleted, malformed response).
 *
 * The caller decides the failure policy. For `publish-article` we soft-skip on
 * any error (record no `youtubePublishedAt` and proceed) — the project's
 * no-fallback rule applies to configuration substitution, not to optional
 * external metadata enrichment.
 */

export type YouTubeFetchErrorCode =
  | 'NOT_YOUTUBE_URL'
  | 'HTTP_ERROR'
  | 'VIDEO_NOT_FOUND'
  | 'MALFORMED_RESPONSE'
  | 'NETWORK_ERROR';

export class YouTubeFetchError extends Error {
  constructor(
    public readonly code: YouTubeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'YouTubeFetchError';
  }
}

/**
 * Extract an 11-character YouTube video ID from any of these URL shapes:
 *   - https://img.youtube.com/vi/<ID>/<size>.jpg       (thumbnail; what we store)
 *   - https://i.ytimg.com/vi/<ID>/<size>.jpg           (alternate thumbnail host)
 *   - https://www.youtube.com/watch?v=<ID>             (watch page)
 *   - https://youtu.be/<ID>                            (short link)
 *   - https://www.youtube.com/embed/<ID>               (embed iframe)
 *
 * Returns `null` if the URL does not match any recognised YouTube pattern, or
 * if the captured ID is not exactly 11 characters of `[A-Za-z0-9_-]`.
 *
 * Pure function — no I/O. Tolerates extra query parameters and fragments.
 */
export function extractYouTubeVideoId(url: string): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  let candidate: string | null = null;

  // Thumbnail hosts: /vi/<ID>/...
  if (host === 'img.youtube.com' || host === 'i.ytimg.com') {
    const match = parsed.pathname.match(/^\/vi\/([A-Za-z0-9_-]{11})\//);
    candidate = match?.[1] ?? null;
  }
  // Short link: youtu.be/<ID>
  else if (host === 'youtu.be') {
    const match = parsed.pathname.match(/^\/([A-Za-z0-9_-]{11})(?:\/|$)/);
    candidate = match?.[1] ?? null;
  }
  // Watch / embed on the main YouTube domain.
  else if (
    host === 'www.youtube.com' ||
    host === 'youtube.com' ||
    host === 'm.youtube.com'
  ) {
    if (parsed.pathname === '/watch') {
      const v = parsed.searchParams.get('v');
      if (v !== null && /^[A-Za-z0-9_-]{11}$/.test(v)) {
        candidate = v;
      }
    } else {
      const match = parsed.pathname.match(
        /^\/(?:embed|shorts|v)\/([A-Za-z0-9_-]{11})(?:\/|$)/,
      );
      candidate = match?.[1] ?? null;
    }
  }

  if (candidate === null) return null;
  if (!/^[A-Za-z0-9_-]{11}$/.test(candidate)) return null;
  return candidate;
}

/**
 * Call the YouTube Data API v3 `videos.list` endpoint with `part=snippet` and
 * return the video's canonical `snippet.publishedAt` (ISO-8601 UTC).
 *
 * Throws `YouTubeFetchError` for every failure path so the caller can decide
 * whether to abort or soft-skip.
 *
 * @param videoId  11-character YouTube video ID.
 * @param apiKey   YouTube Data API v3 key. Must be non-empty.
 * @param fetchImpl Optional fetch implementation (for testing). Defaults to
 *                  the global `fetch`.
 */
export async function fetchYouTubeVideoPublishedAt(
  videoId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new YouTubeFetchError(
      'NOT_YOUTUBE_URL',
      `Invalid video ID: "${videoId}"`,
    );
  }
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new YouTubeFetchError(
      'NETWORK_ERROR',
      'YOUTUBE_API_KEY is empty',
    );
  }

  const endpoint = new URL('https://www.googleapis.com/youtube/v3/videos');
  endpoint.searchParams.set('part', 'snippet');
  endpoint.searchParams.set('id', videoId);
  endpoint.searchParams.set('key', apiKey);

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw new YouTubeFetchError(
      'NETWORK_ERROR',
      `Network failure calling YouTube Data API: ${msg}`,
    );
  }

  if (!response.ok) {
    let bodyText = '';
    try {
      bodyText = (await response.text()).slice(0, 500);
    } catch {
      /* ignore body read errors */
    }
    throw new YouTubeFetchError(
      'HTTP_ERROR',
      `YouTube Data API returned ${response.status} ${response.statusText}: ${bodyText}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw new YouTubeFetchError(
      'MALFORMED_RESPONSE',
      `Failed to parse YouTube Data API response as JSON: ${msg}`,
    );
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    !Array.isArray((payload as { items?: unknown }).items)
  ) {
    throw new YouTubeFetchError(
      'MALFORMED_RESPONSE',
      'YouTube Data API response missing "items" array',
    );
  }

  const items = (payload as { items: unknown[] }).items;
  if (items.length === 0) {
    throw new YouTubeFetchError(
      'VIDEO_NOT_FOUND',
      `No video found for id "${videoId}" (may be deleted or private)`,
    );
  }

  const first = items[0];
  if (
    typeof first !== 'object' ||
    first === null ||
    typeof (first as { snippet?: unknown }).snippet !== 'object' ||
    (first as { snippet: unknown }).snippet === null
  ) {
    throw new YouTubeFetchError(
      'MALFORMED_RESPONSE',
      'YouTube Data API item missing "snippet" object',
    );
  }

  const snippet = (first as { snippet: { publishedAt?: unknown } }).snippet;
  const publishedAt = snippet.publishedAt;
  if (typeof publishedAt !== 'string' || publishedAt.length === 0) {
    throw new YouTubeFetchError(
      'MALFORMED_RESPONSE',
      'YouTube Data API snippet missing "publishedAt"',
    );
  }

  // Normalise to canonical ISO-8601 (parses both Z and ±HH:MM forms).
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) {
    throw new YouTubeFetchError(
      'MALFORMED_RESPONSE',
      `YouTube Data API publishedAt "${publishedAt}" is not a parseable timestamp`,
    );
  }
  return date.toISOString();
}
