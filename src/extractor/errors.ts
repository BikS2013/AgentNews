/**
 * Typed error codes for article metadata extraction failures.
 *
 * - `EMPTY_TITLE`: the article has no <title>, or its <title> is whitespace-only.
 * - `IMG_NO_SRC`: a first <img> exists but has no `src` attribute (or it is an
 *   empty string). Note: the case where there is no <img> at all is NOT an
 *   extractor error — the extractor returns `thumbnailUrl: null` and the caller
 *   (e.g. the publish CLI) decides what to do with that.
 */
export type ArticleMetadataErrorCode = 'EMPTY_TITLE' | 'IMG_NO_SRC';

/** Typed error thrown by the article metadata extractor. */
export class ArticleMetadataError extends Error {
  constructor(
    public readonly code: ArticleMetadataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ArticleMetadataError';
    // Maintains the proper prototype chain when transpiled.
    Object.setPrototypeOf(this, ArticleMetadataError.prototype);
  }
}
