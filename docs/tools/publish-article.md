<publishArticle>
    <objective>
        Publishes a self-contained HTML article from a source file to the site's
        articles directory byte-identically, while appending (or updating) an entry
        in the catalog JSON file with extracted metadata (title, thumbnail URL,
        SHA-256 hash, and publication timestamp).
    </objective>
    <command>
        npx tsx src/cli/publish-article.ts --source &lt;path&gt; [--thumbnail-url &lt;url&gt;] [--update] [--date &lt;ISO-8601&gt;] [--category &lt;deep-dive|ai-news&gt;]

        # Equivalent npm script alias:
        npm run publish-article -- --source &lt;path&gt; [options]
    </command>
    <info>
        ## Description

        publish-article ingests a source HTML file, then performs the following
        steps in order:

          1. Parses the HTML to extract the article title (from &lt;title&gt; or the
             first &lt;h1&gt;) and the first &lt;img&gt; src as the thumbnail URL.
          2. Derives a stable kebab-case slug from the title (suffixed with a
             counter when the base slug is already taken by a different article).
          3. Copies the source file byte-identically to
             &lt;ARTICLES_DIR&gt;/&lt;slug&gt;.html using an atomic write (write to a .tmp
             file, fsync, then rename over the destination).
          4. Computes the SHA-256 hex digest of the file bytes.
          5. Appends a new CatalogEntry to &lt;CATALOG_PATH&gt; (or, with --update,
             replaces the matching existing entry preserving slug and publishedAt).
          6. Writes a single JSON line to stdout representing the CatalogEntry that
             was written.

        The tool never substitutes default values for missing configuration — if
        any required env var is absent, loadConfig() throws immediately and the
        process exits with code 1.

        ---

        ## Configuration

        Configuration is loaded exclusively from environment variables via
        src/config.ts. The four-tier resolution chain (lowest to highest priority)
        is:

          Tier 1 — Shell-registered env vars (process.env at startup)
          Tier 2 — ~/.tool-agents/publish-article/.env  (user-level persistent config)
          Tier 3 — .env in the current working directory  (project/session overrides)
          Tier 4 — CLI flags  (highest priority; wins over all tiers)

        IMPORTANT: This CLI does not implement a multi-tier env-var loader itself —
        it calls loadConfig() which reads process.env directly. To use Tiers 2 and
        3, you must load the relevant .env file into the shell before invoking the
        CLI (e.g. with `source ~/.tool-agents/publish-article/.env` or a dotenv
        shell hook). Tier 4 (CLI flags) applies to article-level arguments (--source,
        --thumbnail-url, etc.) but there are no CLI flags that override PORT,
        ARTICLES_DIR, or CATALOG_PATH — those must be supplied via environment.

        Required environment variables (no defaults; missing values raise an error):

          PORT
            Type:    positive integer, 1–65535
            Purpose: TCP port the HTTP server listens on. loadConfig() validates this
                     and throws if it is missing, not a number, or out of range. The
                     CLI itself does not start a server, but it calls the shared
                     loadConfig() which requires this value.
            Example: PORT=3000

          ARTICLES_DIR
            Type:    non-empty string (project-relative or absolute path)
            Purpose: Directory where published HTML article files are written. The
                     CLI resolves this against process.cwd() if relative.
            Example: ARTICLES_DIR=./articles

          CATALOG_PATH
            Type:    non-empty string (project-relative or absolute path)
            Purpose: Path to the catalog JSON file (data/catalog.json by convention)
                     that tracks all published articles. The CatalogStore reads and
                     writes this file atomically.
            Example: CATALOG_PATH=./data/catalog.json

        ---

        ## Flags

          --source &lt;path&gt;           (REQUIRED)
            Path to the source HTML article to publish. Accepts space-separated
            value (--source ./path/to/file.html) or equals form
            (--source=./path/to/file.html). Resolved to an absolute path against
            process.cwd(). The file must exist and be a regular file.

          --thumbnail-url &lt;url&gt;     (optional)
            Override thumbnail URL. Used ONLY when the source HTML has no &lt;img&gt;
            element. If the HTML contains an &lt;img&gt;, the extracted src always wins
            and this flag is ignored. Accepts space-separated or equals form.

          --update                   (optional, boolean)
            Replace an already-published article. The existing catalog entry is
            located by matching the derived slug against stored slugs, or by
            matching sourcePath. On success, the slug and publishedAt are preserved;
            the file bytes, sha256, thumbnailUrl, thumbnailSource, and sourcePath
            fields are updated. Exits with code 3 if no matching entry is found.

          --date &lt;ISO-8601&gt;         (optional)
            Override the publication timestamp. Must be a full ISO-8601 datetime
            with timezone designator, e.g. 2026-05-22T12:00:00Z or
            2026-05-22T14:00:00+02:00. Defaults to new Date().toISOString() (now).
            Ignored when --update is present (publishedAt is preserved from the
            existing entry). Accepts space-separated or equals form.

            DATE PRIORITY: callers MUST pass the underlying YouTube upload
            date (or the original source-page publication date) when known.
            Only fall back to omitting --date (which stamps "now") when no
            upstream date can be determined. See docs/PUBLISHING.md §3.

          --category &lt;name&gt;         (optional)
            Homepage list placement. One of:
              deep-dive  (default) — technical AI videos shown in the
                                     "Deep Dives" list.
              ai-news              — non-technical AI news videos shown in
                                     the mixed "AI-News" list.
            On --update, omitting the flag preserves the existing entry's
            category; passing it overrides. Accepts space-separated or
            equals form.

          --help / -h                (optional)
            Print usage text to stdout and exit 0.

        ---

        ## Exit Codes

          0   Success. One JSON line written to stdout with the CatalogEntry.
          1   User / argument error. Causes: unknown flag, missing --source,
              no thumbnail found and no --thumbnail-url provided, invalid --date
              format, invalid --category value, title could not be derived from HTML.
          2   IO error. Causes: source file not found, source path is a directory,
              read failure, write failure, catalog load/save failure.
          3   Conflict. Causes: article already published (slug collision with
              matching title) and --update was not passed; OR --update was passed
              but no matching catalog entry was found for the given title/sourcePath.

        ---

        ## Output

        On success (exit 0), a single JSON object is written to stdout:

          {
            "slug": "deep-dive-handoff-is-my-new-favourite-skill",
            "title": "Deep Dive — _handoff is my new favourite skill",
            "publishedAt": "2026-05-22T10:30:00.000Z",
            "sourcePath": "samples/deep-dive-handoff.html",
            "articlePath": "articles/deep-dive-handoff-is-my-new-favourite-skill.html",
            "thumbnailUrl": "https://example.com/thumb.jpg",
            "thumbnailSource": "html",
            "sha256": "e3b0c44298fc1c149afb..."
          }

        thumbnailSource is "html" when the thumbnail was extracted from an &lt;img&gt;
        in the source, or "cli-override" when --thumbnail-url was used.

        All error messages are written to stderr with a structured prefix
        (IO_ERROR:, NO_THUMBNAIL:, ALREADY_PUBLISHED:, UPDATE_TARGET_NOT_FOUND:,
        EXTRACTION_ERROR(&lt;code&gt;):, USER_ERROR:, CONFLICT:) to aid scripting.

        ---

        ## Examples

        # Basic publish (thumbnail extracted from HTML):
        PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json \
          npx tsx src/cli/publish-article.ts \
          --source "samples/my-article.html"

        # Publish with explicit thumbnail override (article has no &lt;img&gt;):
        PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json \
          npx tsx src/cli/publish-article.ts \
          --source "samples/my-article.html" \
          --thumbnail-url "https://cdn.example.com/thumbnails/my-article.jpg"

        # Publish with a specific publication date:
        PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json \
          npx tsx src/cli/publish-article.ts \
          --source "samples/my-article.html" \
          --date "2026-01-15T09:00:00Z"

        # Publish into the AI-News list (mixed videos+articles):
        PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json \
          npx tsx src/cli/publish-article.ts \
          --source "samples/ai-news-roundup.html" \
          --category ai-news \
          --date "2026-01-15T09:00:00Z"

        # Update an already-published article (re-publish changed source):
        PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json \
          npx tsx src/cli/publish-article.ts \
          --source "samples/my-article.html" \
          --update

        # Show help:
        npx tsx src/cli/publish-article.ts --help

        # Capture the CatalogEntry JSON from a successful run:
        entry=$(PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json \
          npx tsx src/cli/publish-article.ts --source samples/my-article.html)
        echo "Published slug: $(echo "$entry" | jq -r .slug)"

        # Using the npm script alias (env vars must still be set):
        PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json \
          npm run publish-article -- --source "samples/my-article.html"
    </info>
</publishArticle>
