<publishExperimentalArticle>
    <objective>
        Publishes a self-contained HTML article from the local experimental/ folder
        to the experimental sibling-site catalog manifest
        (data/experimental-catalog.json), byte-identically. It mirrors the public
        publish-article CLI but writes ONLY into experimental/ and
        data/experimental-catalog.json — never into articles/ or data/catalog.json.
        It is consumed by the cross-repo publish-experimental GitHub Action that
        pushes the built site to a sibling GitHub Pages repository.
    </objective>
    <command>
        npx tsx src/cli/publish-experimental-article.ts --source &lt;path&gt; [--thumbnail-url &lt;url&gt;] [--update] [--date &lt;ISO-8601&gt;] [--category &lt;deep-dive|ai-news&gt;]

        # Equivalent npm script alias:
        npm run publish-experimental-article -- --source &lt;path&gt; [options]
    </command>
    <info>
        ## Description

        publish-experimental-article ingests a source HTML file, then performs the
        following steps in order:

          1. Validates that EXPERIMENTAL_DIR resolves to a path whose basename is
             exactly "experimental"; refuses to write otherwise (single-writer
             guarantee — articles/ is never touched by this CLI).
          2. Validates that EXPERIMENTAL_CATALOG_PATH resolves to a file whose
             basename begins with "experimental-"; refuses to write otherwise
             (single-writer guarantee — data/catalog.json is never touched by this
             CLI).
          3. Parses the HTML to extract the article title (from &lt;title&gt; or the
             first &lt;h1&gt;) and the first &lt;img&gt; src as the thumbnail URL.
          4. Derives a stable kebab-case slug from the title (suffixed with a counter
             when the base slug is already taken by a different article).
          5. Copies the source file byte-identically to
             &lt;EXPERIMENTAL_DIR&gt;/&lt;slug&gt;.html using an atomic write (write to a .tmp
             file, fsync, then rename over the destination).
          6. Computes the SHA-256 hex digest of the file bytes.
          7. Appends a new CatalogEntry to &lt;EXPERIMENTAL_CATALOG_PATH&gt; (or, with
             --update, replaces the matching existing entry preserving slug and
             publishedAt).
          8. If YOUTUBE_API_KEY is set AND the article thumbnail is a YouTube URL,
             enriches the catalog entry with youtubePublishedAt by querying the
             YouTube Data API v3. Absence or failure is logged and soft-skipped —
             this is feature-gating, not a config fallback.
          9. Writes a single JSON line to stdout representing the CatalogEntry that
             was written.

        Single-writer guarantee: the CLI MUST refuse any write that would land
        outside experimental/ or experimental-catalog.json. If the resolved
        EXPERIMENTAL_DIR basename is not exactly "experimental", or the resolved
        EXPERIMENTAL_CATALOG_PATH basename does not start with "experimental-", the
        process exits immediately with code 1. This prevents accidental corruption of
        the public catalog or articles directory.

        The tool never substitutes default values for missing required configuration
        — if EXPERIMENTAL_DIR or EXPERIMENTAL_CATALOG_PATH is absent or empty,
        loadConfig() throws immediately and the process exits with code 1.

        ---

        ## Configuration

        Configuration is loaded exclusively from environment variables. The
        four-tier resolution chain (lowest to highest priority) is:

          Tier 1 — Shell-registered env vars (process.env at startup)
          Tier 2 — ~/.tool-agents/publish-experimental-article/.env
                   (user-level persistent config)
          Tier 3 — .env in the current working directory
                   (project/session overrides)
          Tier 4 — CLI flags (highest priority; wins over all tiers)

        IMPORTANT: This CLI does not implement a multi-tier env-var loader itself —
        it reads process.env directly (same caveat as publish-article). To use Tiers
        2 and 3, load the relevant .env file into the shell before invoking the CLI
        (e.g. with `source ~/.tool-agents/publish-experimental-article/.env` or a
        dotenv shell hook). Tier 4 (CLI flags) applies to article-level arguments
        (--source, --thumbnail-url, etc.) but there are no CLI flags that override
        EXPERIMENTAL_DIR or EXPERIMENTAL_CATALOG_PATH — those must be supplied via
        environment.

        ---

        ## Environment Variables

        Required (no defaults; missing or empty value is a fatal error — exit code 1):

          EXPERIMENTAL_DIR
            Type:    non-empty string (project-relative or absolute path)
            Purpose: Directory where published experimental HTML article files are
                     written. The CLI resolves this against process.cwd() if
                     relative. The resolved path's basename MUST be exactly
                     "experimental"; any other value causes an immediate fatal error.
            Example: EXPERIMENTAL_DIR=./experimental

          EXPERIMENTAL_CATALOG_PATH
            Type:    non-empty string (project-relative or absolute path)
            Purpose: Path to the experimental catalog JSON manifest that tracks all
                     published experimental articles. Must resolve to a file whose
                     basename begins with "experimental-" (e.g.
                     "experimental-catalog.json"). Any other basename causes an
                     immediate fatal error.
            Example: EXPERIMENTAL_CATALOG_PATH=./data/experimental-catalog.json

        Optional (soft feature-gating; absence is logged and silently skipped):

          YOUTUBE_API_KEY
            Type:    string (Google Cloud API key with YouTube Data API v3 access)
            Purpose: When set, AND the article's thumbnail URL is a YouTube URL, the
                     CLI enriches the catalog entry with a youtubePublishedAt field
                     by querying the YouTube Data API v3. Identical behaviour to the
                     publish-article sibling. On absence or API failure the entry is
                     written without youtubePublishedAt — this is feature-gating,
                     NOT a config fallback, and no exception is raised.
            Note:    If YOUTUBE_API_KEY is already exported in your shell, it is
                     inherited automatically; no redefinition in .env is required.

        ---

        ## Flags

          --source &lt;path&gt;           (REQUIRED)
            Path to the source HTML article to publish into the experimental site.
            Accepts space-separated value (--source ./path/to/file.html) or equals
            form (--source=./path/to/file.html). Resolved to an absolute path
            against process.cwd(). The file must exist and be a regular file.

          --thumbnail-url &lt;url&gt;     (optional)
            Override thumbnail URL. Used ONLY when the source HTML has no &lt;img&gt;
            element. If the HTML contains an &lt;img&gt;, the extracted src always wins
            and this flag is ignored. Accepts space-separated or equals form.

          --update                   (optional, boolean)
            Replace an already-published experimental article. The existing catalog
            entry is located by matching the derived slug or sourcePath. On success,
            the slug and publishedAt are preserved; the file bytes, sha256,
            thumbnailUrl, thumbnailSource, and sourcePath fields are updated. Exits
            with code 3 if no matching entry is found.

          --date &lt;ISO-8601&gt;         (optional)
            Override the publication timestamp. Must be a full ISO-8601 datetime
            with timezone designator, e.g. 2026-05-22T12:00:00Z or
            2026-05-22T14:00:00+02:00. Defaults to new Date().toISOString() (now).
            Ignored when --update is present (publishedAt is preserved from the
            existing entry). Accepts space-separated or equals form.

            DATE PRIORITY: callers MUST pass the underlying YouTube upload date (or
            the original source-page publication date) when known. Only fall back to
            omitting --date (which stamps "now") when no upstream date can be
            determined.

          --category &lt;name&gt;         (optional)
            Homepage list placement for the experimental site. One of:
              deep-dive  (default) — technical AI videos shown in the
                                     "Deep Dives" list.
              ai-news              — non-technical AI news videos shown in
                                     the mixed "AI-News" list.
            On --update, omitting the flag preserves the existing entry's category;
            passing it overrides. Accepts space-separated or equals form.

          --help / -h                (optional)
            Print usage text to stdout and exit 0.

        ---

        ## Exit Codes

          0   Success. One JSON line written to stdout with the CatalogEntry.
          1   User / argument error. Causes: unknown flag, missing --source,
              no thumbnail found and no --thumbnail-url provided, invalid --date
              format, invalid --category value, title could not be derived from HTML,
              EXPERIMENTAL_DIR or EXPERIMENTAL_CATALOG_PATH missing/empty, basename
              validation failed (single-writer guarantee violation).
          2   IO error. Causes: source file not found, source path is a directory,
              read failure, write failure, catalog load/save failure.
          3   Conflict. Causes: article already published (slug collision with
              matching title) and --update was not passed; OR --update was passed but
              no matching catalog entry was found for the given title/sourcePath.

        ---

        ## Output

        On success (exit 0), a single JSON object is written to stdout:

          {
            "slug": "experimental-deep-dive-handoff",
            "title": "Deep Dive — _handoff is my new favourite skill",
            "publishedAt": "2026-05-22T10:30:00.000Z",
            "sourcePath": "samples/deep-dive-handoff.html",
            "articlePath": "experimental/experimental-deep-dive-handoff.html",
            "thumbnailUrl": "https://example.com/thumb.jpg",
            "thumbnailSource": "html",
            "sha256": "e3b0c44298fc1c149afb...",
            "youtubePublishedAt": "2026-05-20T08:00:00Z"
          }

        thumbnailSource is "html" when the thumbnail was extracted from an &lt;img&gt; in
        the source, or "cli-override" when --thumbnail-url was used.
        youtubePublishedAt is present only when YOUTUBE_API_KEY is set and the
        thumbnail URL is a YouTube URL.

        All error messages are written to stderr with a structured prefix
        (IO_ERROR:, NO_THUMBNAIL:, ALREADY_PUBLISHED:, UPDATE_TARGET_NOT_FOUND:,
        EXTRACTION_ERROR(&lt;code&gt;):, USER_ERROR:, CONFLICT:, WRITER_GUARD:) to aid
        scripting. WRITER_GUARD: is emitted when the basename validation fails.

        ---

        ## Single-Writer Guarantee

        This CLI is the SOLE authorized writer to experimental/ and
        data/experimental-catalog.json. It NEVER touches:
          - articles/              (owned exclusively by publish-article)
          - data/catalog.json      (owned exclusively by publish-article)

        Any attempt to configure EXPERIMENTAL_DIR to resolve to a path not named
        "experimental", or EXPERIMENTAL_CATALOG_PATH to a file not beginning with
        "experimental-", is rejected at startup with exit code 1 and a WRITER_GUARD:
        error on stderr.

        ---

        ## Examples

        # Basic publish (thumbnail extracted from HTML):
        EXPERIMENTAL_DIR=./experimental \
        EXPERIMENTAL_CATALOG_PATH=./data/experimental-catalog.json \
          npx tsx src/cli/publish-experimental-article.ts \
          --source "samples/my-article.html"

        # Publish with explicit thumbnail override (article has no &lt;img&gt;):
        EXPERIMENTAL_DIR=./experimental \
        EXPERIMENTAL_CATALOG_PATH=./data/experimental-catalog.json \
          npx tsx src/cli/publish-experimental-article.ts \
          --source "samples/my-article.html" \
          --thumbnail-url "https://cdn.example.com/thumbnails/my-article.jpg"

        # Publish with a specific publication date:
        EXPERIMENTAL_DIR=./experimental \
        EXPERIMENTAL_CATALOG_PATH=./data/experimental-catalog.json \
          npx tsx src/cli/publish-experimental-article.ts \
          --source "samples/my-article.html" \
          --date "2026-01-15T09:00:00Z"

        # Publish into the AI-News list:
        EXPERIMENTAL_DIR=./experimental \
        EXPERIMENTAL_CATALOG_PATH=./data/experimental-catalog.json \
          npx tsx src/cli/publish-experimental-article.ts \
          --source "samples/ai-news-roundup.html" \
          --category ai-news \
          --date "2026-01-15T09:00:00Z"

        # Update an already-published experimental article:
        EXPERIMENTAL_DIR=./experimental \
        EXPERIMENTAL_CATALOG_PATH=./data/experimental-catalog.json \
          npx tsx src/cli/publish-experimental-article.ts \
          --source "samples/my-article.html" \
          --update

        # Enrich with YouTube metadata (YOUTUBE_API_KEY already in shell):
        EXPERIMENTAL_DIR=./experimental \
        EXPERIMENTAL_CATALOG_PATH=./data/experimental-catalog.json \
          npx tsx src/cli/publish-experimental-article.ts \
          --source "samples/my-yt-article.html" \
          --date "2026-01-15T09:00:00Z"

        # Show help:
        npx tsx src/cli/publish-experimental-article.ts --help

        # Capture the CatalogEntry JSON from a successful run:
        entry=$(EXPERIMENTAL_DIR=./experimental \
          EXPERIMENTAL_CATALOG_PATH=./data/experimental-catalog.json \
          npx tsx src/cli/publish-experimental-article.ts \
          --source samples/my-article.html)
        echo "Published slug: $(echo "$entry" | jq -r .slug)"

        # Using the npm script alias (env vars must still be set):
        EXPERIMENTAL_DIR=./experimental \
        EXPERIMENTAL_CATALOG_PATH=./data/experimental-catalog.json \
          npm run publish-experimental-article -- --source "samples/my-article.html"
    </info>
</publishExperimentalArticle>
