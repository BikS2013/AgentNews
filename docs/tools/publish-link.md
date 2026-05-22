<publishLink>
    <objective>
        Curate an external article URL into Agent News. Fetches the source
        page, extracts Open Graph / Twitter-card metadata (title, image,
        summary, source site), and appends (or updates) a LinkEntry in the
        links JSON file. CLI flags override any extracted field. Used for
        the "Articles" and "AI-News" homepage lists.
    </objective>
    <command>
        npx tsx src/cli/publish-link.ts --url &lt;URL&gt; [--title &lt;text&gt;] [--image-url &lt;URL&gt;] [--summary &lt;text&gt;] [--source-site &lt;host&gt;] [--date &lt;ISO-8601&gt;] [--category &lt;article|ai-news&gt;] [--update]

        # Equivalent npm script alias:
        npm run publish-link -- --url &lt;URL&gt; [options]
    </command>
    <info>
        ## Description

        publish-link curates a third-party article into Agent News without
        copying the article body. The card on the home page links out to the
        original publisher (target="_blank"). Steps performed, in order:

          1. Fetch the source URL and parse Open Graph / Twitter-card /
             &lt;title&gt; / &lt;h1&gt; / &lt;meta description&gt; metadata.
          2. Merge extracted fields with CLI overrides — explicit flags win.
          3. Derive a kebab-case id from the title (suffixed on collision).
          4. Reject the publish if title or image is still missing after
             merge (NO_TITLE / NO_IMAGE, exit 1).
          5. Atomically append (or, with --update, replace) a LinkEntry in
             &lt;LINKS_PATH&gt;.
          6. Write a one-line JSON of the LinkEntry to stdout.

        ---

        ## Configuration

        Required environment variables (no defaults — missing raises):

          PORT              — required by loadConfig() shared validator.
          ARTICLES_DIR      — required by loadConfig() (not used by this CLI).
          CATALOG_PATH      — required by loadConfig() (not used by this CLI).
          LINKS_PATH        — path to the links JSON file (data/links.json by convention).

        Optional environment variables:

          LINK_USER_AGENT   — User-Agent string used when fetching source URLs.

        ---

        ## Flags

          --url &lt;URL&gt;               (REQUIRED)
            Absolute http(s) URL of the source article. Must be parseable as
            a valid URL with protocol http or https.

          --title &lt;text&gt;            (optional override)
            Override the article title. By default the title is auto-extracted
            from og:title, &lt;title&gt;, or the first &lt;h1&gt;. Strip site-name suffixes
            ("— YouTube", "| The Verge") before passing.

          --image-url &lt;URL&gt;         (optional override)
            Override the card image. By default it is auto-extracted from
            og:image, twitter:image, or the first &lt;img&gt; on the page. Must be
            an absolute http(s) URL when overriding.

          --summary &lt;text&gt;          (optional override)
            Short description shown under the title on the card. By default
            extracted from og:description or &lt;meta name="description"&gt;.

          --source-site &lt;host&gt;      (optional override)
            Hostname displayed under the card title (e.g. "www.anthropic.com").
            Defaults to the URL's hostname.

          --date &lt;ISO-8601&gt;         (optional)
            Publication timestamp. Must be a full ISO-8601 datetime with
            timezone designator, e.g. 2026-05-22T12:00:00Z. Defaults to
            new Date().toISOString() (now).

            DATE PRIORITY: callers MUST pass the original article's
            publication date on the source publisher's site when known.
            Only fall back to omitting --date when no upstream date can be
            determined. See docs/PUBLISHING.md §3.

          --category &lt;name&gt;         (optional)
            Homepage list placement. One of:
              article  (default) — curated AI articles in the "Articles" list.
              ai-news            — non-technical AI news links shown in the
                                   mixed "AI-News" list.
            On --update, omitting preserves the existing category; passing
            it overrides.

          --update                   (optional, boolean)
            Replace an existing LinkEntry whose URL matches. Preserves id
            and publishedAt; updates title, imageUrl, summary, sourceSite,
            category.

          --help / -h                (optional)
            Print usage text to stdout and exit 0.

        ---

        ## Exit Codes

          0   Success. One JSON line of the LinkEntry written to stdout.
          1   User / argument error. Causes: missing --url, invalid URL,
              invalid --date, invalid --category, NO_TITLE, NO_IMAGE.
          2   IO error. Links file load/save failure.
          3   Conflict. Link with same URL already exists and --update was
              not passed.

        ---

        ## Examples

        # Basic curate (all metadata auto-extracted):
        PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json LINKS_PATH=./data/links.json \
          npx tsx src/cli/publish-link.ts \
          --url "https://www.anthropic.com/news/some-post" \
          --date "2025-11-12T09:00:00Z"

        # Curate into the AI-News list (mixed videos+articles):
        PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json LINKS_PATH=./data/links.json \
          npx tsx src/cli/publish-link.ts \
          --url "https://www.nytimes.com/technology/some-ai-story" \
          --category ai-news \
          --date "2025-11-12T09:00:00Z"

        # Override extracted fields:
        PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json LINKS_PATH=./data/links.json \
          npx tsx src/cli/publish-link.ts \
          --url "https://example.com/article" \
          --title "Cleaner title" \
          --image-url "https://example.com/cover.jpg" \
          --summary "One-line description" \
          --date "2025-11-12T09:00:00Z"

        # Replace an existing entry by URL:
        PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json LINKS_PATH=./data/links.json \
          npx tsx src/cli/publish-link.ts \
          --url "https://example.com/article" \
          --update

        # Using the npm script alias:
        PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json LINKS_PATH=./data/links.json \
          npm run publish-link -- --url "https://example.com/article"
    </info>
</publishLink>
