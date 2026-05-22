import * as cheerio from 'cheerio';

import { ArticleMetadataError } from './errors.js';

/**
 * Metadata extracted from a self-contained HTML article.
 *
 * `thumbnailUrl` is `null` when the article contains no <img> element at all.
 * That case is NOT an extractor error — the caller (e.g. the publish CLI) is
 * responsible for deciding how to handle it (for example, by accepting a
 * --thumbnail-url override).
 */
export type ArticleMetadata = {
  title: string;
  thumbnailUrl: string | null;
};

/**
 * Extract `title` and `thumbnailUrl` from a raw HTML buffer.
 *
 * Behavior:
 * 1. Loads the buffer with `cheerio.loadBuffer`, which runs the HTML5
 *    encoding-sniffing algorithm based on the document's declared charset.
 * 2. Reads the trimmed text of the first <title>. Throws
 *    `ArticleMetadataError('EMPTY_TITLE', ...)` when missing or empty.
 * 3. Finds the first <img> in document order:
 *    - If no <img> exists, returns `thumbnailUrl: null` (NOT an error).
 *    - If an <img> exists but has no `src` (or it is empty), throws
 *      `ArticleMetadataError('IMG_NO_SRC', ...)`.
 *    - Otherwise returns the raw `src` value with no normalization.
 *
 * The input buffer is never modified, and cheerio never writes anything back
 * to disk.
 */
export function extractArticleMetadata(htmlBuffer: Buffer): ArticleMetadata {
  const $ = cheerio.loadBuffer(htmlBuffer);

  // --- Title ---
  const title = $('title').first().text().trim();
  if (title.length === 0) {
    throw new ArticleMetadataError(
      'EMPTY_TITLE',
      'Article has no <title> or <title> is empty',
    );
  }

  // --- Thumbnail (first <img> in document order) ---
  const firstImg = $('img').first();
  let thumbnailUrl: string | null;

  if (firstImg.length === 0) {
    // No <img> at all — not an extractor error. Caller decides.
    thumbnailUrl = null;
  } else {
    const src = firstImg.attr('src');
    if (src === undefined || src === '') {
      throw new ArticleMetadataError(
        'IMG_NO_SRC',
        'First <img> has no src attribute',
      );
    }
    thumbnailUrl = src;
  }

  return { title, thumbnailUrl };
}
