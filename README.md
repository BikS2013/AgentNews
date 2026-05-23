# Agent News

A small Node.js + TypeScript site that hosts self-contained HTML articles **byte-for-byte identical to their source files** and exposes a catalog page listing every published article (title, publication date, thumbnail).

The article HTML is the sacred bit: every byte you put in is every byte the browser receives. The catalog page around it is server-rendered HTML you can style freely.

## Live sites

| Site                       | URL                                                                                | Source repo                                                                                  | Deployed by                                  |
|----------------------------|------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|----------------------------------------------|
| **Agent News** (public)    | <https://biks2013.github.io/AgentNews/>                                            | this repo (`BikS2013/AgentNews`)                                                              | `.github/workflows/deploy.yml`               |
| **Agent News Experimental**| <https://biks2013.github.io/AgentNews-Experimental/>                               | sibling repo (`BikS2013/AgentNews-Experimental`, branch `gh-pages`)                           | `.github/workflows/publish-experimental.yml` |

The experimental site is structurally isolated from the public site (separate folder, separate manifest, separate CLI, separate build, separate deploy workflow, separate repository). It is publicly reachable to anyone who knows the URL — privacy is by unadvertised URL only, NOT by authentication. See [`docs/design/project-design.md`](docs/design/project-design.md) → "Experimental Sibling Publish" for the full design rationale.

## How it works

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  publish-article │───▶│  data/catalog.   │───▶│  Fastify server  │
│  CLI             │    │  json            │    │  GET /           │
│                  │    │                  │    │  GET /a/:slug    │
│  + copy file     │    │  + articles/     │    │                  │
│    byte-identi-  │    │    <slug>.html   │    │  sendFile() →    │
│    cally         │    │    (byte-iden-   │    │  raw stream,     │
│                  │    │    tical)        │    │  no rewriting    │
└──────────────────┘    └──────────────────┘    └──────────────────┘
```

The publish step is the only writer; the server is read-only. The article buffer is never touched between source-on-disk and socket-to-browser.

## Requirements

- Node.js `>=20`
- npm (or compatible)

## Install

```bash
npm install
```

## Configuration

Three environment variables are **required** at runtime. There are **no fallback values** — missing or invalid configuration is a fatal startup error.

| Variable        | Description                                | Example                   |
| --------------- | ------------------------------------------ | ------------------------- |
| `PORT`          | HTTP port (positive integer, ≤ 65535)      | `3000`                    |
| `ARTICLES_DIR`  | Path to the published articles directory   | `./articles`              |
| `CATALOG_PATH`  | Path to the JSON catalog manifest          | `./data/catalog.json`     |

Copy `.env.example` to `.env` (or export them in your shell):

```bash
cp .env.example .env
```

## Usage

### 1. Publish an article

```bash
PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json \
  npm run publish-article -- --source "samples/Deep Dive — _handoff is my new favourite skill (Matt Pocock).html"
```

The CLI:

1. Reads the source HTML as a buffer.
2. Extracts the `<title>` and the `src` of the first `<img>` via cheerio.
3. Atomically copies the file byte-identically to `articles/<slug>.html`.
4. Computes its SHA-256.
5. Appends an entry to `data/catalog.json`.

For articles that have no `<img>` (e.g. only an `<iframe>` embed), pass an explicit thumbnail:

```bash
... --source samples/some-article.html \
    --thumbnail-url "https://img.youtube.com/vi/abc123/maxresdefault.jpg"
```

Re-publishing a previously published article requires `--update`. The original `publishedAt` is preserved.

Full flags:

| Flag                       | Required | Description                                          |
| -------------------------- | -------- | ---------------------------------------------------- |
| `--source <path>`          | yes      | Path to source HTML file                             |
| `--thumbnail-url <url>`    | no       | Required only if HTML has no `<img>`                 |
| `--update`                 | no       | Replace an existing entry (preserves slug and date)  |
| `--date <ISO-8601>`        | no       | Override publication date (default: `now()`)         |
| `--help`                   | no       | Print usage                                          |

Exit codes: `0` success · `1` user/argument error · `2` IO error · `3` conflict.

### 2. Run the server

```bash
PORT=3000 ARTICLES_DIR=./articles CATALOG_PATH=./data/catalog.json npm run dev
```

Open <http://localhost:3000/> for the catalog, or <http://localhost:3000/a/:slug> for an individual article.

### 3. Verify byte-identity

```bash
npm test
```

The suite includes end-to-end checks that compute SHA-256 on the raw HTTP response buffer and assert equality with the source file and the catalog's stored hash.

## Project layout

```
.
├── articles/                       # Byte-identical published HTML files
├── data/
│   └── catalog.json                # The catalog manifest
├── samples/                        # 7 sample articles bundled with the repo
├── src/
│   ├── config.ts                   # Env-var loader (no fallbacks)
│   ├── catalog/                    # Slug, types, atomic JSON store
│   ├── extractor/                  # cheerio-based metadata extraction
│   ├── cli/publish-article.ts      # The publish CLI
│   ├── server.ts                   # Fastify entry point
│   └── server/
│       ├── routes/                 # GET / and GET /a/:slug
│       └── render/catalog.ts       # Server-rendered catalog HTML
├── test_scripts/                   # 202 tests (node:test + tsx)
└── docs/
    ├── design/                     # Plan, design, functions
    ├── reference/                  # Refined request, investigation, scans
    ├── research/                   # Technical deep-dives
    └── tools/                      # Tool documentation
```

## Catalog file format

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-05-22T20:45:00.000Z",
  "entries": [
    {
      "slug": "deep-dive-handoff-is-my-new-favourite-skill-matt-pocock",
      "title": "Deep Dive: /handoff is my new favourite skill — Matt Pocock",
      "publishedAt": "2026-05-22T20:30:00.000Z",
      "sourcePath": "samples/Deep Dive — _handoff is my new favourite skill (Matt Pocock).html",
      "articlePath": "articles/deep-dive-handoff-is-my-new-favourite-skill-matt-pocock.html",
      "thumbnailUrl": "https://img.youtube.com/vi/dtAJ2dOd3ko/maxresdefault.jpg",
      "thumbnailSource": "html",
      "sha256": "604a15a3ca5aff0b1e134861d04b07839c41ada99f313cddf5646843a2eeea04"
    }
  ]
}
```

`thumbnailSource` is `"html"` when extracted from the article body, or `"cli-override"` when supplied via `--thumbnail-url`.

## npm scripts

| Script                  | What it does                                              |
| ----------------------- | --------------------------------------------------------- |
| `npm run dev`           | Start the server with `tsx` (no build step)               |
| `npm start`             | `tsc` then `node dist/server.js`                          |
| `npm run publish-article` | Run the publish CLI (pass flags after `--`)             |
| `npm run verify`        | Standalone byte-identity verification script              |
| `npm run typecheck`     | `tsc --noEmit`                                            |
| `npm test`              | Run the full `node:test` suite                            |

## Tech stack

| Component         | Pinned         | Why                                                                            |
| ----------------- | -------------- | ------------------------------------------------------------------------------ |
| Fastify           | `^5.8.5`       | Lightweight HTTP framework with a clean `reply.sendFile()` seam                |
| `@fastify/static` | `^9.1.3`       | CVE-patched static plugin (registered with `serve: false` + explicit route)    |
| cheerio           | `^1.2.0`       | jQuery-like HTML parser, used only at publish time for metadata extraction     |
| TypeScript        | `^6.0.3`       | `strict: true`, `noUncheckedIndexedAccess`, `NodeNext` module resolution        |
| tsx               | `^4.22.3`      | Run TS directly without a build step                                            |

No database. No frontend framework. No bundler.

## Byte-identity guarantees

The architecture makes byte-identity a property of the system, not a hope:

1. The CLI copies the source buffer directly to disk (`fs.writeFile`) — no parser writes to that file.
2. The server registers `@fastify/static` with `serve: false`, then explicitly calls `reply.sendFile()` which pipes `fs.createReadStream` to the response.
3. `@fastify/compress` is **never** registered. The article route also sets `Content-Encoding: identity` defensively.
4. ETag, Last-Modified, and content-type sniffing are disabled on the static plugin; the article route forces `Content-Type: text/html; charset=utf-8`.
5. Slug validation at the route level (`^[a-z0-9]+(-[a-z0-9]+)*$`) rejects anything that could be a path-traversal attempt.

The test suite verifies all of this end-to-end against all bundled samples.

## Experimental sibling site

In addition to the public `articles/` flow, the repo carries a parallel
**experimental** pipeline that publishes byte-identical HTML articles to a
SEPARATE GitHub Pages site hosted in a different repository (the "target
repo"). Use it for material you don't want to surface on the main Agent News
site. The two flows share zero state and are guarded by separate single-writer
checks.

```
┌──────────────────────────────────────┐    ┌─────────────────────────────────┐
│  publish-experimental-article CLI    │───▶│  GitHub Action                  │
│                                      │    │  publish-experimental.yml       │
│  + writes to experimental/<slug>.html│    │                                 │
│    byte-identically                  │    │  + builds dist-experimental/    │
│  + appends/updates                   │    │  + force-pushes to              │
│    data/experimental-catalog.json    │    │    <TARGET_REPO_OWNER>/         │
│                                      │    │    <TARGET_REPO_NAME>           │
│  REFUSES to touch articles/ or       │    │    on TARGET_BRANCH             │
│  data/catalog.json                   │    │                                 │
└──────────────────────────────────────┘    └─────────────────────────────────┘
```

### Authoring

```bash
EXPERIMENTAL_DIR=./experimental \
EXPERIMENTAL_CATALOG_PATH=./data/experimental-catalog.json \
  npm run publish-experimental-article -- --source "samples/some-deep-dive.html"
```

Same flags as `publish-article` (`--source`, `--thumbnail-url`, `--update`,
`--date`, `--category`). The CLI refuses to start if `EXPERIMENTAL_DIR`'s
basename is not exactly `experimental` or if `EXPERIMENTAL_CATALOG_PATH`'s
basename does not start with `experimental-`.

### Publishing

Pushing to `main` with changes under `experimental/**` (or
`data/experimental-catalog.json`, or the build script, or the workflow itself)
triggers `.github/workflows/publish-experimental.yml`. You can also trigger
it manually from the Actions tab.

Before the first run, set in this repo's Settings → Variables / Secrets:

| Name                | Kind     | Purpose                                                            |
|---------------------|----------|--------------------------------------------------------------------|
| `TARGET_REPO_OWNER` | variable | GitHub user/org that owns the target repo                          |
| `TARGET_REPO_NAME`  | variable | Target repo name                                                   |
| `TARGET_BRANCH`     | variable | Branch to force-push to (recommend `gh-pages`)                     |
| `GH_PAT`            | secret   | Fine-grained PAT scoped to the target repo with `contents:write`   |
| `GH_PAT_EXPIRES_AT` | variable | ISO-8601 expiration date of the PAT                                |
| `GH_PAT_WARN_DAYS`  | variable | Days-until-expiry to start emitting `::warning::` annotations      |

Missing values cause the workflow to fail fast in its preflight step — no
fallback defaults. See `docs/design/configuration-guide.md` for the full
reference.

### Privacy posture

**The experimental site is NOT authenticated.** Anyone who knows or guesses
the target Pages URL can read its content. "Private" here means only that:

- The main `agent-news` Pages site contains zero links, files, or catalog
  entries that reference experimental content (verified by a regression test).
- The target repo's Pages URL is not advertised anywhere by this project.

If you need real access control, neither this repo nor GitHub Pages (on
non-Enterprise plans) provides it — you'd need a different host.

## Documentation

- Refined request: [`docs/reference/refined-request-html-article-publishing-site.md`](docs/reference/refined-request-html-article-publishing-site.md)
- Refined request — experimental sibling-publish: [`docs/reference/refined-request-experimental-sibling-publish.md`](docs/reference/refined-request-experimental-sibling-publish.md)
- Investigation (approach comparison): [`docs/reference/investigation-html-article-publishing.md`](docs/reference/investigation-html-article-publishing.md)
- Plan: [`docs/design/plan-001-html-article-publishing-site.md`](docs/design/plan-001-html-article-publishing-site.md)
- Plan — experimental sibling-publish: [`docs/design/plan-002-experimental-sibling-publish.md`](docs/design/plan-002-experimental-sibling-publish.md)
- Design: [`docs/design/project-design.md`](docs/design/project-design.md)
- Functional requirements: [`docs/design/project-functions.md`](docs/design/project-functions.md)
- Configuration guide: [`docs/design/configuration-guide.md`](docs/design/configuration-guide.md)
- Tool documentation: [`docs/tools/publish-article.md`](docs/tools/publish-article.md), [`docs/tools/publish-experimental-article.md`](docs/tools/publish-experimental-article.md), [`docs/tools/publish-link.md`](docs/tools/publish-link.md)
- Migrating items between Agent News and Agent News Experimental: [`docs/MIGRATING-CONTENT.md`](docs/MIGRATING-CONTENT.md)
- Open items: [`Issues - Pending Items.md`](Issues%20-%20Pending%20Items.md)

## License

UNLICENSED (private).
