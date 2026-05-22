# @fastify/static — Byte-Identical HTML Serving

**Research date**: 2026-05-22
**Depth level**: Intermediate
**Scope**: Configuration for guaranteed byte-identical serving of self-contained HTML article files (23–42 KB) using Fastify + `@fastify/static` on Node.js LTS.

---

## Updates to Investigation

> These findings update or refine the investigation document at `docs/reference/investigation-html-article-publishing.md`. Read this section first.

1. **Version to pin has changed.** The investigation was written before CVE-2026-6410 and CVE-2026-6414 were published on 16 April 2026. Both vulnerabilities affect `@fastify/static` versions `<= 9.1.0`. The current patched release is **9.1.3** (latest as of 2026-05-22). **Pin `^9.1.3`, not any earlier version.** The investigation's advice to use "latest stable" was correct in direction but the floor has moved.

2. **`list` option MUST be `false` (default).** CVE-2026-6410 is a path-traversal vulnerability that only triggers when the `list` option is enabled. The investigation does not mention `list`; this research confirms it must never be enabled on article-serving registrations.

3. **CVE-2026-6414 is not a byte-identity issue but is a security issue.** It allows encoded path separators (`%2F`) to bypass route guards. For article serving (where there are no route guards — every article is public), this CVE does not affect the byte-identity guarantee. However, it DOES affect any registration that fronts a protected directory with route-level middleware. Upgrading to 9.1.3 eliminates both CVEs.

4. **`preCompressed` is the only `@fastify/static`-native path to a body-altering response.** When `preCompressed: true` and a `.br` or `.gz` sidecar file exists alongside the source file, the plugin serves the sidecar and sets `Content-Encoding: br` (or `gzip`). The response body will NOT match the source SHA-256. This option must remain `false` (its default).

5. **`@fastify/compress` registration order matters more than the investigation noted.** When `@fastify/compress` is registered BEFORE `@fastify/static`, it intercepts ALL outgoing streams including static files — even if the route handler is `reply.sendFile()`. The investigation says "don't register globally"; this research adds: even if you think you registered compress on a subset of routes via a plugin scope, `@fastify/compress` uses Fastify's `onSend` hook which fires for every reply in the same scope. The safe pattern is to register `@fastify/compress` in a separate encapsulated scope that does NOT include the article routes, or use `reply.header('Content-Encoding', 'identity')` before `reply.sendFile()` as a belt-and-suspenders guard.

6. **v9.1.0 introduced a bug: `sendFile` ignored option overrides in some cases.** Fixed in v9.1.1 (PR #559: "fix: sendFile ignoring option overrides in some cases"). This is directly relevant to the pattern of calling `reply.sendFile('slug.html', { cacheControl: false, etag: false })` — on versions 9.1.0 this might silently revert to plugin defaults. Pin to 9.1.3 ensures this fix is present.

---

## Overview

`@fastify/static` is the official Fastify plugin for serving static files from disk. It wraps `@fastify/send` (itself a fork of the classic `send` library) and exposes the `reply.sendFile()` decorator. The response body is produced by piping a `fs.createReadStream` from `@fastify/send` directly into the HTTP response — no buffering, no rewriting, no transformation at the plugin layer itself.

For the byte-identity requirement, the key insight is: **`@fastify/static` never touches the response body bytes in the default configuration**. The threat comes from opt-in features (`preCompressed`, `@fastify/compress` globally, `@fastify/send`'s Range slicing) or misconfiguration. This document maps each option to its byte-identity impact and provides a production-ready reference configuration.

---

## Key Concepts

| Term | Meaning in this context |
|---|---|
| **Byte-identity** | `sha256(HTTP response body) === sha256(source file on disk)` for a full-file GET (no Range header) |
| **`@fastify/send`** | The lower-level streaming library used by `@fastify/static`. Handles ETag, Last-Modified, Range, MIME detection, and the actual `fs.createReadStream` |
| **Conditional GET** | Client sends `If-None-Match` or `If-Modified-Since`; server may reply 304 with empty body. NOT a byte-identity violation — the body is empty, not rewritten |
| **Range request** | Client sends `Range: bytes=0-1023`; server replies 206 Partial Content. This IS a byte-identity violation if you test SHA-256 of a partial response. Test scripts MUST send a plain GET with no Range header |
| **`preCompressed`** | Plugin-level feature that serves `.br`/`.gz` sidecars instead of the source file. Body bytes differ from source → breaks byte-identity |
| **`@fastify/compress`** | Separate plugin that GZIP/Brotli-encodes the response stream on-the-fly via `onSend` hook. Breaks byte-identity if applied to article routes |

---

## Installation

```bash
# Vetted 2026-05-22 — pin to ^9.1.3 (patches CVE-2026-6410, CVE-2026-6414)
npm install @fastify/static@^9.1.3
```

For TypeScript projects the package ships its own types — no `@types/` install needed.

Fastify 5.x compatibility: `@fastify/static` v9.x requires Fastify v5. The v8.x line targets Fastify v4.

---

## Full Option Reference — Byte-Identity Impact

All options below are for the `fastify.register(fastifyStatic, { ... })` call. Options delegated to `@fastify/send` are noted.

### Plugin-Level Options

#### `root` (required)
**Type**: `string | string[]`

The absolute path (or array of paths) of the directory containing files to serve. Must be absolute; relative paths are rejected. When an array is given, files are looked up in order ("first found, first served").

**Byte-identity impact**: None. This is a filesystem root, not a body transformer.

**Recommendation**: Set to the `articles/` directory absolute path.

```typescript
root: path.join(__dirname, '..', 'articles')
```

---

#### `prefix`
**Type**: `string`
**Default**: `'/'`

URL path prefix. The plugin registers wildcard routes under this prefix (e.g., `GET /a/*`). Does not affect response body.

**Byte-identity impact**: None.

**Recommendation**: Set to `'/a/'` for article routes.

---

#### `serve`
**Type**: `boolean`
**Default**: `true`

When `false`, the plugin does NOT register any wildcard GET routes — it only decorates `reply` with `sendFile`. Useful when you want to control routing yourself and call `reply.sendFile()` manually from your own route handlers.

**Byte-identity impact**: None. Affects routing, not body.

**Recommendation for this project**: Set `serve: false`. Register an explicit `GET /a/:slug` route and call `reply.sendFile()` inside it. This gives you full control: you validate the slug, look it up in `catalog.json`, and call `sendFile` with the exact filename. You avoid the wildcard route entirely.

---

#### `decorateReply`
**Type**: `boolean`
**Default**: `true`

Adds `reply.sendFile()` and `reply.download()` methods to the Fastify reply object. Set to `false` only when registering a second plugin instance (multiple roots) to avoid "already decorated" errors.

**Byte-identity impact**: None.

**Recommendation**: `true` (default) for the first and only registration.

---

#### `setHeaders`
**Type**: `(res: ServerResponse, path: string, stat: Stats) => void`
**Default**: `undefined`

Callback invoked synchronously before the response is sent, allowing you to set custom headers. `res` is the raw Node.js `ServerResponse`. You can call `res.setHeader()` but NOT modify the body.

**Byte-identity impact**: None — headers only. However, use this carefully: do NOT set `Content-Encoding: gzip` here; that would cause clients to attempt decoding a body that has not been encoded.

**Recommendation**: Use `setHeaders` to force the correct `Content-Type` header and add any security headers. See the code example section for the exact pattern.

---

#### `wildcard`
**Type**: `boolean`
**Default**: `true`

When `true`, adds a catch-all `GET prefix/*` route. When `false`, globs the `root` directory at startup and registers one route per file — newly added files are NOT served until restart.

**Byte-identity impact**: None.

**Recommendation**: When using `serve: false` (recommended above), `wildcard` is irrelevant — no routes are registered by the plugin. If you do use `serve: true`, set `wildcard: true` so new articles are served without restart.

---

#### `index`
**Type**: `string | string[] | false`
**Default**: `undefined` (which `@fastify/send` treats as `'index.html'`)

Controls automatic index file resolution when a directory path is requested. Passing `false` disables index resolution entirely.

**Byte-identity impact**: None for explicit-file requests. Potentially confusing if an article directory accidentally matches.

**Recommendation**: Set `index: false` explicitly. Article routes are explicit slug-to-file mappings; there are no directories to auto-index.

---

#### `redirect`
**Type**: `boolean`
**Default**: `false`

When `true`, requests for directories without a trailing slash are redirected (301) to the slash-suffixed URL. When `false`, such requests fall through to Fastify's 404 handler.

**Byte-identity impact**: None.

**Recommendation**: `false` (default). Articles are files, not directories.

---

#### `dotfiles`
Passed to `@fastify/send`. Controls how files starting with `.` are handled.

- `'allow'`: served normally
- `'deny'`: 403
- `'ignore'` (default-ish): 404

**Byte-identity impact**: None.

**Recommendation**: Leave at default (`'ignore'`). Article files do not start with dots.

---

#### `preCompressed`
**Type**: `boolean`
**Default**: `false`

When `true`, looks for `filename.br` and `filename.gz` sidecars alongside the requested file. If a sidecar exists AND the client's `Accept-Encoding` supports it, the sidecar is served with the corresponding `Content-Encoding` header.

**Byte-identity impact**: CRITICAL. If a `.br` or `.gz` file exists alongside any article, the plugin will serve the compressed sidecar instead of the source file. `sha256(response body) !== sha256(source file)`.

**Recommendation**: MUST be `false` (default). Never set to `true` for article serving. Document this as a hard project invariant.

---

#### `allowedPath`
**Type**: `(pathName: string, root: string, request: FastifyRequest) => boolean`
**Default**: `() => true`

A filter function — returning `false` causes the plugin to call Fastify's 404 handler instead of serving the file.

**Byte-identity impact**: None (affects access control, not body content).

**Recommendation**: Not needed when using `serve: false` with explicit routes. If used, ensure it never returns `false` for valid slugs.

---

#### `list`
**Type**: `boolean | object`
**Default**: `undefined` (disabled)

When set, enables directory listing (JSON or HTML) for the root directory.

**Byte-identity impact**: None directly. **Security impact**: CVE-2026-6410 path traversal is only exploitable when `list` is enabled. Leaving this at its default (disabled) eliminates this CVE class entirely.

**Recommendation**: MUST be `undefined` / not set. Never enable directory listing on article-serving registrations.

---

### `@fastify/send` Options (Passed Through)

These are passed directly to the `@fastify/send` module and control the response headers and conditional-GET behavior.

#### `cacheControl`
**Type**: `boolean`
**Default**: `true`

When `true`, `@fastify/send` sets a `Cache-Control` header based on `maxAge` and `immutable`. When `false`, no `Cache-Control` header is emitted — you control it yourself via `setHeaders` or route-level `reply.header()`.

**Byte-identity impact**: None (header only, not body).

**Recommendation**: Set `cacheControl: false` at the plugin level so the server does not emit cache directives you haven't explicitly chosen. Set the actual cache policy you want via `reply.header('Cache-Control', '...')` in the route handler or `setHeaders`.

---

#### `etag`
**Type**: `boolean`
**Default**: `true`

When `true`, `@fastify/send` computes a weak ETag from the file's inode, size, and last-modified timestamp (not content-hash), and emits `ETag: W/"..."`. If the request carries `If-None-Match` matching the ETag, a 304 Not Modified is returned with an empty body.

**Byte-identity impact**: The response body on 304 is empty — this is NOT a rewrite of the file bytes; it is a separate HTTP response class. A byte-identity verification test that issues a plain GET (no `If-None-Match` header) will always receive the full body. The 304 path is safe for byte-identity purposes as long as the test script handles it (see verification snippet).

**Recommendation**: Safe to leave `etag: true` (default) for production caching efficiency. If you want the absolute simplest setup for a test environment, set `etag: false` to eliminate 304 responses entirely.

---

#### `lastModified`
**Type**: `boolean`
**Default**: `true`

Emits `Last-Modified` header. Similar to `etag`: triggers 304 on `If-Modified-Since` match.

**Byte-identity impact**: Same as `etag` — 304 has empty body, not a rewrite.

**Recommendation**: Safe to leave `true`. The verification test script should strip `If-Modified-Since` from requests (send a plain GET).

---

#### `acceptRanges`
**Type**: `boolean`
**Default**: `true`

When `true`, emits `Accept-Ranges: bytes` and handles `Range` request headers, serving a 206 Partial Content with the requested byte slice.

**Byte-identity impact**: If a client sends `Range: bytes=0-100`, the response body is a SLICE of the file — `sha256(slice) !== sha256(source file)`. This breaks byte-identity. However: **plain GET requests (no Range header) are not affected even when `acceptRanges` is true**. The plugin only slices when the client requests it.

**Recommendation**: `acceptRanges: true` is fine for production (supports large-file download resumption). The verification test script MUST send plain GET requests with no Range header. As an extra safety measure during testing, set `acceptRanges: false` temporarily to confirm no Range requests are sneaking in.

---

#### `contentType`
**Type**: `boolean`
**Default**: `true`

When `true`, `@fastify/send` uses the `mime` module to detect `Content-Type` from the file extension. When `false`, no `Content-Type` is set automatically — you must set it manually.

**Byte-identity impact**: None (header only).

**MIME detection behavior**: The `mime` module maps `.html` to `text/html`. However, it does NOT automatically append `; charset=utf-8`. The actual Content-Type emitted by `@fastify/send` for `.html` files is `text/html` (no charset).

**How to force `text/html; charset=utf-8`**: Override via `setHeaders`:

```typescript
setHeaders: (res, filePath) => {
  if (filePath.endsWith('.html')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
  }
}
```

Or in the route handler:

```typescript
reply.header('Content-Type', 'text/html; charset=utf-8')
return reply.sendFile(filename)
```

**Important**: The `setHeaders` approach fires before the response is sent but `@fastify/send` sets Content-Type after `setHeaders` runs in some versions. The safest method is to set the header in the route handler (before calling `sendFile`), OR set `contentType: false` in the plugin options and always set it explicitly in `setHeaders`.

**Recommendation**: Set `contentType: false` in plugin options; use `setHeaders` to always emit `Content-Type: text/html; charset=utf-8` for `.html` files. This removes any ambiguity about MIME detection.

---

#### `maxAge`
**Type**: `number | string`
**Default**: `0`

Sets the `max-age` component of `Cache-Control`. Only effective when `cacheControl: true`.

**Byte-identity impact**: None (header only).

**Recommendation**: Leave at `0` (or use `cacheControl: false` and set your own).

---

#### `immutable`
**Type**: `boolean`
**Default**: `false`

Adds the `immutable` directive to `Cache-Control`. Only effective when `cacheControl: true`.

**Byte-identity impact**: None.

---

#### `extensions`
**Type**: `string[]`
**Default**: `false`

If the requested file does not exist, try appending these extensions. E.g., `['html']` would serve `articles/my-slug.html` for a request to `/articles/my-slug`.

**Byte-identity impact**: None — still serves the same file bytes.

**Recommendation**: Not needed when slug-to-filename mapping is explicit in the route handler.

---

## `reply.sendFile()` vs Manual `fs.createReadStream` Piping

### Option A: `reply.sendFile(filename, [root], [options])`

This is the standard approach. Internally it calls `@fastify/send`, which:
1. Resolves the absolute path: `path.join(root, filename)`.
2. `stat()`s the file to get size and mtime.
3. Handles conditional GET (ETag / Last-Modified) — may short-circuit with 304.
4. Handles Range requests — may slice the stream.
5. Sets `Content-Type`, `Content-Length`, `ETag`, `Last-Modified`, `Accept-Ranges`, `Cache-Control` headers.
6. Returns a `{ statusCode, headers, stream }` object.
7. The stream is a `fs.createReadStream` (possibly sliced for Range, but for a plain GET it covers `start: 0, end: fileSize - 1`).
8. `@fastify/static` pipes the stream to the reply.

**Byte-identity for full GET (no Range header)**: Guaranteed. The bytes flowing through the stream are identical to the bytes on disk. Nothing rewrites them.

**Verification of guarantee**: Look at `@fastify/send`'s source — for a non-Range request, the stream is opened with default `start`/`end` (entire file). `fs.createReadStream` in Node.js does not transform bytes. There is no buffering layer that modifies content.

### Option B: Manual `fs.createReadStream` piping

```typescript
import fs from 'node:fs'
import path from 'node:path'

fastify.get('/a/:slug', async (request, reply) => {
  const { slug } = request.params as { slug: string }
  const filePath = path.join(ARTICLES_DIR, `${slug}.html`)
  reply.header('Content-Type', 'text/html; charset=utf-8')
  reply.header('Content-Length', fs.statSync(filePath).size)
  return reply.send(fs.createReadStream(filePath))
})
```

This also achieves byte-identity for a plain GET. However, it loses:
- Automatic ETag / Last-Modified / 304 handling (must implement manually if wanted)
- Range request support
- Automatic Content-Length computation
- Path traversal protection built into `@fastify/send`

**Recommendation**: Use `reply.sendFile()`. It provides byte-identity AND all the HTTP semantics for free. Only use manual streaming if you have a specific reason to bypass `@fastify/send`.

---

## Interaction with `@fastify/compress`

`@fastify/compress` works by registering a Fastify `onSend` hook. When the hook fires, it inspects the response payload and compresses it if:
- The response size exceeds the configured `threshold` (default: 1024 bytes)
- The client sent `Accept-Encoding` supporting a compatible encoding
- The route is not excluded

If `@fastify/compress` is registered globally (no scope restriction), it WILL compress the response from `reply.sendFile()`. The response body will be GZIP/Brotli-encoded — `sha256(response body) !== sha256(source file)`. **This breaks byte-identity.**

### Safe patterns for using compress alongside article routes

**Pattern 1 (Recommended): Separate encapsulated scopes**

Register `@fastify/compress` only inside a scope that does not include the article routes. Fastify's plugin system is scope-based — hooks registered in a child scope do not fire for routes outside that scope.

```typescript
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCompress from '@fastify/compress'
import path from 'node:path'

const app = Fastify()

const ARTICLES_DIR = path.resolve(__dirname, '..', 'articles')

// Scope 1: Article serving — NO compress registered here
app.register(async function articleScope(scope) {
  scope.register(fastifyStatic, {
    root: ARTICLES_DIR,
    serve: false,
    decorateReply: true,
    index: false,
    cacheControl: false,
    etag: true,
    lastModified: true,
    acceptRanges: true,
    preCompressed: false,
    contentType: false, // we set it manually below
    dotfiles: 'deny',
    list: undefined,
  })

  scope.get('/a/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string }
    // slug validation happens here (lookup in catalog)
    const filename = `${slug}.html`
    reply.header('Content-Type', 'text/html; charset=utf-8')
    return reply.sendFile(filename)
  })
})

// Scope 2: Catalog and other compressible routes — compress is safe here
app.register(async function catalogScope(scope) {
  scope.register(fastifyCompress, { threshold: 1024 })

  scope.get('/', async (request, reply) => {
    // ... render catalog HTML
  })
})

await app.listen({ port: 3000 })
```

**Pattern 2: `reply.header('Content-Encoding', 'identity')` before sendFile**

This is a belt-and-suspenders guard. Setting `Content-Encoding: identity` before `@fastify/compress`'s `onSend` hook fires causes the hook to skip compression on that response (the compress plugin respects the existing encoding header).

```typescript
scope.get('/a/:slug', async (request, reply) => {
  const filename = `${slug}.html`
  reply.header('Content-Encoding', 'identity')
  reply.header('Content-Type', 'text/html; charset=utf-8')
  return reply.sendFile(filename)
})
```

**Caution**: RFC 7231 says `Content-Encoding: identity` is a valid value but some older clients may not handle it well. Prefer Pattern 1 (scope isolation) as the primary mechanism; use Pattern 2 as an additional explicit signal.

**Pattern 3: `@fastify/compress` `encodings` filter (unreliable)**

`@fastify/compress` supports a per-request `compress` option via route config, but this requires patching each route definition and is easy to forget. Not recommended as the sole mechanism.

---

## ETag / Last-Modified / 304 Handling

### What happens in practice

When a browser (or test script) requests an article:
1. First request: server returns 200 with full body, `ETag: W/"..."`, `Last-Modified: <date>`.
2. Second request (browser re-validation): browser sends `If-None-Match: W/"..."`. Server matches, returns 304 with empty body and no Content-Type.
3. Browser uses cached copy.

### Is 304 a byte-identity violation?

No. A 304 response has an empty body by HTTP spec. The file bytes are not rewritten — they are simply not re-transmitted. The bytes stored in the browser cache from the 200 response are still byte-identical to the source file.

### ETag computation

`@fastify/send` generates ETags using the formula:
```
`${stat.mtime.getTime().toString(16)}-${stat.size.toString(16)}`
```
This is a **weak ETag based on mtime and size, not a content hash**. Implication: if you replace a file with different content but the same size within the same filesystem timestamp resolution (usually 1s on most filesystems), the ETag will not change. For the article-publishing use case (write-once immutable articles) this is fine — files are not replaced in place (the idempotency check prevents that).

### Impact on verification tests

The verification test script MUST:
- Send requests with **no `If-None-Match` or `If-Modified-Since` headers** to guarantee a 200 response with full body.
- If the test receives a 304, it must recognise this as "cached hit" and either re-fetch without conditional headers, or fail loudly (a 304 in a fresh test session indicates a bug in the test setup).

---

## Content-Type and Charset

### How `@fastify/send` determines Content-Type

`@fastify/send` uses the `mime` npm module. For `.html` extension:

```
mime.getType('index.html')  // returns 'text/html'
```

The charset is NOT appended automatically. The emitted header is:
```
Content-Type: text/html
```

This does NOT satisfy the requirement of `text/html; charset=utf-8`.

### How to force `Content-Type: text/html; charset=utf-8`

**Method 1 (recommended)**: Set `contentType: false` in plugin options and use `setHeaders` to always apply the correct header for `.html` files:

```typescript
fastify.register(fastifyStatic, {
  root: ARTICLES_DIR,
  contentType: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
    }
  },
  // ...other options
})
```

**Method 2**: Set the header in the route handler before calling `sendFile`:

```typescript
scope.get('/a/:slug', async (request, reply) => {
  reply.header('Content-Type', 'text/html; charset=utf-8')
  return reply.sendFile(`${slug}.html`)
})
```

Note: Fastify's `reply.header()` sets headers on the reply object. When `@fastify/static` calls `reply.sendFile()`, it may overwrite Content-Type if `contentType: true` (default). Setting `contentType: false` in plugin options AND calling `reply.header()` in the route handler is the most reliable combination.

**Method 3**: Custom `mime` module override (advanced, not recommended for this use case):

```typescript
import send from '@fastify/send'
send.mime.define({ 'text/html; charset=utf-8': ['html', 'htm'] })
```

Modifying the global mime instance affects the entire process. Prefer Method 1.

---

## Range Request Behaviour

### What the plugin does

When `acceptRanges: true` (default):
- Every response includes `Accept-Ranges: bytes` header.
- A client that sends `Range: bytes=0-999` receives a 206 Partial Content with only the first 1000 bytes.
- The `@fastify/send` module opens the `fs.createReadStream` with `{ start, end }` corresponding to the range.
- Bytes within the range are served verbatim — no transformation.

### Does this break byte-identity?

For a **full-file GET** (no Range header): No. The stream is `start: 0, end: fileSize - 1`.

For a **Range GET** (with `Range` header): Yes — `sha256(partial body) !== sha256(full file)`.

### Practical guidance

- **Browser behavior**: Browsers never send Range headers for initial page loads. Range is used by download managers, media players, and resume-capable downloads.
- **Test script requirement**: Test scripts verifying byte-identity MUST NOT send a Range header. If using `curl`, omit `-r`. If using `fetch` or `node:http`, do not set a Range header.
- **Disable for belt-and-suspenders**: Set `acceptRanges: false` in the plugin to prevent any Range response. Slight downside: large-file download resumption no longer works. For 23–42 KB HTML files this is irrelevant.

---

## Production Pattern: Slug → Filename Mapping

The recommended layout stores articles as `articles/<slug>.html`:

```
articles/
  deep-dive-typescript-generics.html        (42 KB)
  building-a-fastify-server.html            (31 KB)
  understanding-css-grid.html               (28 KB)
catalog.json
```

The route handler maps slug → filename with a catalog lookup for existence validation:

```typescript
scope.get('/a/:slug', async (request, reply) => {
  const { slug } = request.params as { slug: string }

  // 1. Validate slug format to prevent path traversal attempts
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return reply.callNotFound()
  }

  // 2. Look up in catalog (ensure the article is published)
  const entry = catalog.find(e => e.slug === slug)
  if (!entry) {
    return reply.callNotFound()
  }

  // 3. Serve the file — filename derived directly from slug
  const filename = `${slug}.html`
  reply.header('Content-Type', 'text/html; charset=utf-8')
  return reply.sendFile(filename)
})
```

**Why do we validate the slug against the catalog?** Even though `@fastify/send` prevents path traversal by construction (it joins `root + filename` and checks containment), validating against the catalog serves two purposes:
1. Returns 404 for articles not yet published (file may exist on disk before publish).
2. Ensures the slug only ever matches an explicitly registered article.

**`reply.sendFile(filename, rootOverride)`**: If the articles directory is outside the registered `root`, pass the root as the second argument:

```typescript
return reply.sendFile(filename, path.resolve('/srv/articles'))
```

---

## Minimal Working TypeScript Example

This is a complete, production-ready Fastify server configuration for byte-identical article serving.

```typescript
// src/server.ts
import Fastify, { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import { readFileSync } from 'node:fs'

// --- Types ---
interface CatalogEntry {
  slug: string
  title: string
  publishedAt: string
  thumbnailUrl: string | null
  sourcePath: string
  sha256: string
}

// --- Configuration (no fallbacks — throws if missing) ---
const ARTICLES_DIR = process.env.ARTICLES_DIR
if (!ARTICLES_DIR) throw new Error('ARTICLES_DIR environment variable is required')

const CATALOG_PATH = process.env.CATALOG_PATH
if (!CATALOG_PATH) throw new Error('CATALOG_PATH environment variable is required')

// --- Catalog loader ---
function loadCatalog(): CatalogEntry[] {
  const raw = readFileSync(CATALOG_PATH!, 'utf-8')
  return JSON.parse(raw) as CatalogEntry[]
}

// --- Server factory ---
export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true })

  let catalog = loadCatalog()

  // -----------------------------------------------------------------------
  // Article scope — NO @fastify/compress registered here
  // -----------------------------------------------------------------------
  await app.register(async function articleScope(scope) {
    scope.register(fastifyStatic, {
      root: path.resolve(ARTICLES_DIR!),

      // Do NOT serve files automatically — we control routing via explicit route
      serve: false,

      // Keep reply.sendFile() decorator
      decorateReply: true,

      // Disable index file resolution — articles are not directories
      index: false,

      // Disable directory listing — never needed, prevents CVE-2026-6410
      // list: undefined (default)

      // Disable auto Cache-Control — we manage it ourselves
      cacheControl: false,

      // ETag enabled — 304 responses are safe for byte-identity (empty body)
      etag: true,

      // Last-Modified enabled — same reasoning as etag
      lastModified: true,

      // Range requests are safe for byte-identity on plain GET
      // (disable if you want absolute certainty no Range response is possible)
      acceptRanges: true,

      // CRITICAL: must be false — preCompressed would serve .br/.gz sidecars
      // instead of source file, breaking byte-identity
      preCompressed: false,

      // Disable automatic MIME detection — we set Content-Type explicitly
      contentType: false,

      // Deny dotfiles for safety
      dotfiles: 'deny',

      // setHeaders: force correct Content-Type for all .html files
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
        }
      },
    })

    // Explicit article route
    scope.get<{ Params: { slug: string } }>('/a/:slug', async (request, reply) => {
      const { slug } = request.params

      // 1. Validate slug — only lowercase letters, numbers, hyphens
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return reply.callNotFound()
      }

      // 2. Check catalog — article must be published
      const entry = catalog.find(e => e.slug === slug)
      if (!entry) {
        return reply.callNotFound()
      }

      // 3. Set Content-Type explicitly (belt-and-suspenders alongside setHeaders)
      reply.header('Content-Type', 'text/html; charset=utf-8')

      // 4. Stream the file — sendFile handles ETag, Last-Modified, Range
      //    The bytes flowing to the client are identical to the source file
      return reply.sendFile(`${slug}.html`)
    })
  })

  // -----------------------------------------------------------------------
  // Catalog / other routes scope — @fastify/compress can be registered here
  // -----------------------------------------------------------------------
  // await app.register(async function catalogScope(scope) {
  //   scope.register(fastifyCompress, { threshold: 1024 })
  //   scope.get('/', catalogHandler)
  // })

  return app
}

// --- Entry point ---
const server = await buildServer()
await server.listen({ port: 3000, host: '0.0.0.0' })
```

---

## DO NOT List — Options/Plugins That Break Byte-Identity

| Item | Why it breaks byte-identity | Safe alternative |
|---|---|---|
| `preCompressed: true` | Serves `.br`/`.gz` sidecar instead of source file. Response body differs. | Keep at `false` (default). Never create `.br`/`.gz` sidecars in the articles directory. |
| `@fastify/compress` registered in article scope | `onSend` hook GZIP/Brotli-encodes the response stream. `sha256(body) != sha256(source)`. | Register compress only in catalog/non-article scopes. |
| `reply.header('Content-Encoding', 'gzip')` manually | Marks body as gzip-encoded when it isn't (confuses clients); clients attempting decompression see different bytes. | Never set encoding headers on article routes unless you actually compress. |
| Setting `Content-Encoding: br` in `setHeaders` | Same as above. | Omit entirely. |
| `list: true` or `list: { ... }` | Enables directory listing (also CVE-2026-6410 path traversal). | Leave `list` unset. |
| Any HTML minification middleware | Rewrites whitespace and attributes. | Not part of Fastify by default; ensure no custom `onSend` hook minifies HTML. |
| Nginx/Caddy reverse proxy with `gzip on` | Upstream proxy gzips before sending to client. Body bytes differ from source. | Either disable gzip at proxy for article paths, or use `Accept-Encoding: identity` in tests. |
| Cloudflare "Auto Minify" or Rocket Loader | CDN post-processes HTML responses. | Disable zone-level auto-minify for article paths. Use a Page Rule or Transform Rule. |
| `@fastify/static` versions `<= 9.1.0` | Affected by CVE-2026-6410 (path traversal) and CVE-2026-6414 (route guard bypass); 9.1.0 also has the `sendFile option override` bug. | Pin to `^9.1.3`. |
| Using `reply.download()` instead of `reply.sendFile()` | `reply.download()` sets `Content-Disposition: attachment; filename="..."` which is a header change, not a body change — technically not a byte-identity break. But it causes browsers to download rather than render. | Use `reply.sendFile()` for article routes. |
| HTTP/2 header compression (HPACK) | Compresses HTTP headers, not body — not a byte-identity issue. | No action needed. |

---

## Verification Snippet

The following TypeScript test script verifies that every published article is served byte-identically. It handles 304 responses correctly by stripping conditional headers, and forces identity encoding in the HTTP client.

```typescript
// test_scripts/verify-byte-identity.ts
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import http from 'node:http'

interface CatalogEntry {
  slug: string
  sourcePath: string
  sha256: string
}

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const ARTICLES_DIR = process.env.ARTICLES_DIR
if (!ARTICLES_DIR) throw new Error('ARTICLES_DIR is required')
const CATALOG_PATH = process.env.CATALOG_PATH
if (!CATALOG_PATH) throw new Error('CATALOG_PATH is required')

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

/**
 * Fetch a URL with no conditional headers and Accept-Encoding: identity.
 * Follows the response and asserts it is a 200 (not 304, not 206).
 */
async function fetchFull(url: string): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, {
      headers: {
        // Force identity encoding — no compression
        'Accept-Encoding': 'identity',
        // Explicitly omit If-None-Match and If-Modified-Since
        // (http.get does not set them by default, but be explicit)
      },
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        })
      })
    })
    req.on('error', reject)
  })
}

async function main(): Promise<void> {
  const catalog: CatalogEntry[] = JSON.parse(readFileSync(CATALOG_PATH!, 'utf-8'))

  let passed = 0
  let failed = 0
  const errors: string[] = []

  for (const entry of catalog) {
    const url = `${BASE_URL}/a/${entry.slug}`

    // --- 1. Compute SHA-256 of the source file ---
    const sourceFilePath = path.join(ARTICLES_DIR!, `${entry.slug}.html`)
    const sourceBytes = readFileSync(sourceFilePath)
    const sourceHash = sha256(sourceBytes)

    // Cross-check against the catalog-stored sha256
    if (sourceHash !== entry.sha256) {
      errors.push(`CATALOG MISMATCH: ${entry.slug} — disk hash (${sourceHash}) != catalog hash (${entry.sha256})`)
      failed++
      continue
    }

    // --- 2. Fetch the article ---
    const response = await fetchFull(url)

    // --- 3. Assert 200 (not 304, not 206, not 404) ---
    if (response.statusCode === 304) {
      errors.push(`304 RECEIVED for ${entry.slug} — test must be run without prior conditional headers. Check test setup.`)
      failed++
      continue
    }
    if (response.statusCode !== 200) {
      errors.push(`HTTP ${response.statusCode} for ${entry.slug}`)
      failed++
      continue
    }

    // --- 4. Assert no Content-Encoding (or only 'identity') ---
    const encoding = response.headers['content-encoding']
    if (encoding && encoding !== 'identity') {
      errors.push(`ENCODING VIOLATION: ${entry.slug} has Content-Encoding: ${encoding} — compression is applied, byte-identity broken`)
      failed++
      continue
    }

    // --- 5. Compute SHA-256 of the response body ---
    const responseHash = sha256(response.body)

    // --- 6. Assert byte-identity ---
    if (sourceHash !== responseHash) {
      errors.push(`HASH MISMATCH: ${entry.slug} — source (${sourceHash}) != response (${responseHash})`)
      failed++
      continue
    }

    // --- 7. Assert Content-Type ---
    const ct = response.headers['content-type'] ?? ''
    if (!ct.toLowerCase().includes('text/html') || !ct.toLowerCase().includes('utf-8')) {
      errors.push(`CONTENT-TYPE: ${entry.slug} has Content-Type: ${ct} — expected text/html; charset=utf-8`)
      failed++
      continue
    }

    console.log(`PASS  ${entry.slug} (${sourceBytes.length} bytes, sha256=${sourceHash.slice(0, 12)}...)`)
    passed++
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${catalog.length} articles`)

  if (errors.length > 0) {
    console.error('\nErrors:')
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

### Notes on the verification snippet

- `Accept-Encoding: identity` tells the server the client accepts only unencoded (identity) responses. A correctly configured server will not compress. An incorrectly configured server (compress globally) will still compress — this flag ensures you detect the failure.
- The script deliberately uses Node's built-in `http.get` (not `fetch`) to avoid any automatic decompression that higher-level HTTP clients may apply silently. `node-fetch` and the WHATWG `fetch` implementation both decompress automatically, which would make SHA-256 of the "body" match the source even when compression was applied — masking the violation.
- Testing against a real running server (not a mock) is essential — the test only proves byte-identity if it goes through the full Fastify + `@fastify/static` + `@fastify/send` stack.

---

## Best Practices

1. **Pin to `@fastify/static@^9.1.3`** — patches both CVEs and the sendFile option override bug.
2. **Use `serve: false` with explicit routes** — gives full control over slug validation and catalog lookup before serving.
3. **Set `contentType: false` and use `setHeaders` for explicit `text/html; charset=utf-8`** — removes MIME ambiguity.
4. **Scope isolation for `@fastify/compress`** — register compress in a separate child plugin scope, never in the article scope.
5. **Never create `.br`/`.gz` sidecars in the articles directory** — one misplaced file + `preCompressed: true` (if ever accidentally enabled) would silently break byte-identity. Keep compress OFF always.
6. **Set `index: false`** — prevents unexpected index file resolution if a directory somehow appears in the articles root.
7. **Validate slugs against a regex before calling `sendFile`** — even though `@fastify/send` prevents path traversal, early validation produces cleaner 404s and avoids filesystem probing.
8. **Always test with a fresh HTTP client session** — no shared cookie/session state, no pre-populated cache headers. The verification script enforces this by construction.
9. **Run `npm audit` after installing** — confirm advisory count is zero before deploying.

---

## Common Pitfalls

### Pitfall 1: Registering `@fastify/compress` globally

The most common mistake. Even if you intend it only for the catalog page, registering it outside any scope applies the `onSend` hook to all routes in the app.

```typescript
// WRONG
app.register(fastifyCompress) // applies to /a/:slug too
app.register(fastifyStatic, { ... })

// RIGHT
app.register(async function compressed(scope) {
  scope.register(fastifyCompress)
  scope.get('/', catalogHandler)
})
// article routes registered outside the compressed scope
```

### Pitfall 2: Forgetting `contentType: false` and assuming charset is set

The `mime` module maps `.html` → `text/html` without a charset. If you send an article file with `Content-Type: text/html` (no charset), browsers may apply their own charset detection, which can mis-render non-ASCII content. More importantly, the acceptance criterion requires `charset=utf-8` explicitly.

### Pitfall 3: Using `reply.download()` instead of `reply.sendFile()`

`reply.download()` adds `Content-Disposition: attachment`, causing browsers to download the file rather than render it. No body change, but wrong user experience.

### Pitfall 4: Setting `preCompressed: true` and placing compressed files in articles dir

If a team member adds `articles/my-article.html.gz` to the articles directory and `preCompressed: true` is set, all requests for `my-article.html` from browsers that send `Accept-Encoding: gzip` will receive the gzip file with `Content-Encoding: gzip`. Byte-identity is broken.

### Pitfall 5: A reverse proxy gzipping the response

If Nginx or Caddy sits in front of Fastify and has `gzip on` for `text/html`, the bytes reaching the client are compressed even though Fastify sent them uncompressed. The verification test should run against the actual request path (through the proxy, not directly to Fastify) when a proxy is present.

### Pitfall 6: `@fastify/static` v9.1.0 `sendFile` option override bug

On v9.1.0, passing per-request options to `reply.sendFile('file.html', { cacheControl: false })` was silently ignored in some cases, reverting to plugin defaults. Fixed in v9.1.1. Pinning to `^9.1.3` prevents this.

### Pitfall 7: Stale catalog vs filesystem mismatch

If an article file is renamed or moved on disk while the server is running, `sendFile` will return a 404 (file not found). The server will log the error and Fastify's error handler fires. Always update `catalog.json` atomically alongside any file operation via the `publish-article` CLI tool.

---

## Security Notes

### CVE-2026-6410 — Path Traversal in Directory Listing

- **Fixed in**: 9.1.1
- **Affected**: 9.1.0 and earlier with `list` option enabled
- **Impact**: Remote unauthenticated attacker can list arbitrary directories accessible to the Node.js process
- **Mitigation**: Do not set `list`. Upgrade to 9.1.3.

### CVE-2026-6414 — Route Guard Bypass via Encoded Path Separators

- **Fixed in**: 9.1.1
- **Affected**: 9.1.0 and earlier
- **Impact**: `%2F` in URL bypasses route-based middleware guards, allowing access to files in subdirectories
- **Impact on this project**: Article files are publicly accessible by design — there are no route guards to bypass. This CVE is not exploitable in a configuration with no access-controlled paths. However, upgrade to 9.1.3 regardless.

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|---|---|---|
| `@fastify/send` does not transform bytes for a plain full-file GET | HIGH | Core premise fails; would need manual stream piping instead |
| `mime` module maps `.html` to `text/html` without charset | HIGH (verified from `@fastify/send` README) | charset may already be present; `setHeaders` override is still safe |
| v9.1.3 is the latest stable version as of research date (2026-05-22) | HIGH | Run `npm view @fastify/static version` to confirm before pinning |
| Fastify v5 is required for `@fastify/static` v9.x | HIGH (from compatibility table) | If project uses Fastify v4, pin `@fastify/static@^8.x` instead |
| `@fastify/compress` `onSend` hook fires for `reply.sendFile()` responses | HIGH (documented behavior) | If not, scope isolation is still best practice |
| Article files are `.html` extension only | HIGH (from investigation) | If other extensions need serving, adjust `setHeaders` condition |
| Verification test runs against an HTTP/1.1 connection (not HTTP/2) | MEDIUM | HTTP/2 HPACK compresses headers (not body) — byte-identity of body is unaffected |

## Uncertainties & Gaps

- **`contentType: false` + `setHeaders` interaction order**: The README implies `setHeaders` fires before the response is sent, and setting `contentType: false` prevents `@fastify/send` from re-setting it. This is the documented behavior but the exact order of operations in the Fastify `onSend` pipeline was not verified by reading `@fastify/static`'s source code directly. The belt-and-suspenders approach (both `contentType: false` AND `reply.header()` in the route) is recommended.
- **`@fastify/send` ETag format**: Documented as mtime+size hex, but the exact implementation may vary by version. The verification script does not rely on ETag value correctness — only body bytes matter.
- **HTTP/2 and Range request behavior**: Not tested. For 23–42 KB files, Range requests are uncommon. `acceptRanges: false` eliminates this vector entirely if needed.

## Clarifying Questions for Follow-up

1. Will a reverse proxy (Nginx, Caddy, Cloudflare) sit in front of the Fastify server in production? If yes, the verification test must run through the proxy path, and proxy-level compression/rewriting must be audited.
2. Should `etag: false` and `lastModified: false` be set in the development environment to eliminate 304 responses during testing? This simplifies the test setup at the cost of no caching headers in dev.
3. Is there a requirement to serve articles over HTTP/2? If yes, confirm that the TLS termination layer (if any) does not have header compression that interferes with byte-identity assertions.
4. Will the `articles/` directory ever be located on a network filesystem (NFS, FUSE) or cloud-mounted volume? If so, `mtime` precision issues could cause incorrect ETag matches across deploys.

---

## References

| # | Source | URL | Information Gathered |
|---|--------|-----|---------------------|
| 1 | @fastify/static GitHub README | https://github.com/fastify/fastify-static/blob/main/README.md | Full option reference: `serve`, `root`, `prefix`, `index`, `wildcard`, `redirect`, `cacheControl`, `setHeaders`, `etag`, `lastModified`, `acceptRanges`, `preCompressed`, `decorateReply`, `list`, `dotfiles`, `allowedPath`, `extensions`, `contentType`, `maxAge`, `immutable`, `schemaHide`, `logLevel` |
| 2 | @fastify/send GitHub README | https://github.com/fastify/send/blob/main/README.md | Underlying streaming engine: ETag format, Range handling, conditional GET, `contentType` option, `acceptRanges`, `cacheControl`, `lastModified`, `dotfiles`, `extensions`, `index`, `immutable`, `maxAge` |
| 3 | @fastify/static GitHub Releases | https://github.com/fastify/fastify-static/releases | v9.1.3 is latest (2026-04-21); v9.1.1 patches CVE-2026-6410 and CVE-2026-6414 (2026-04-16); v9.1.0 introduced the sendFile option override bug (fixed in v9.1.1 PR #559) |
| 4 | CVE-2026-6414 Advisory (GitLab) | https://advisories.gitlab.com/npm/@fastify/static/CVE-2026-6414/ | Route guard bypass via `%2F` encoded path separators; affects v9.1.0 and earlier; fixed in 9.1.1 |
| 5 | CVE-2026-6410 Advisory (GitLab) | https://advisories.gitlab.com/npm/@fastify/static/CVE-2026-6410/ | Path traversal via directory listing; affects v9.1.0 and earlier with `list` enabled; fixed in 9.1.1 |
| 6 | Snyk @fastify/static vulnerabilities | https://security.snyk.io/package/npm/fastify-static | Confirmed both CVEs; recommended fix version 9.1.1+ |
| 7 | Context7 @fastify/static docs | https://context7.com/fastify/fastify-static/llms.txt | `preCompressed` behavior, `setHeaders` callback signature, compress integration pattern, `reply.sendFile()` per-request options |
| 8 | SentinelOne CVE-2026-6414 | https://www.sentinelone.com/vulnerability-database/cve-2026-6414/ | Severity, attack vector, CVSS details |
| 9 | SentinelOne CVE-2026-6410 | https://www.sentinelone.com/vulnerability-database/cve-2026-6410/ | Severity (Medium), CVSS details, requires `list` to be exploitable |
