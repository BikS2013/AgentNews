# Agent News

A small Node.js + TypeScript site that hosts self-contained HTML articles **byte-for-byte identical to their source files** and exposes a catalog page listing every published article (title, publication date, thumbnail).

The article HTML is the sacred bit: every byte you put in is every byte the browser receives. The catalog page around it is server-rendered HTML you can style freely.

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

## Documentation

- Refined request: [`docs/reference/refined-request-html-article-publishing-site.md`](docs/reference/refined-request-html-article-publishing-site.md)
- Investigation (approach comparison): [`docs/reference/investigation-html-article-publishing.md`](docs/reference/investigation-html-article-publishing.md)
- Plan: [`docs/design/plan-001-html-article-publishing-site.md`](docs/design/plan-001-html-article-publishing-site.md)
- Design: [`docs/design/project-design.md`](docs/design/project-design.md)
- Functional requirements: [`docs/design/project-functions.md`](docs/design/project-functions.md)
- Tool documentation: [`docs/tools/publish-article.md`](docs/tools/publish-article.md)
- Open items: [`Issues - Pending Items.md`](Issues%20-%20Pending%20Items.md)

## License

UNLICENSED (private).
