/**
 * Article route — `GET /a/:slug`.
 *
 * Serves the published HTML article file byte-identically. Responsible
 * for slug validation, catalog lookup, and forcing the response headers
 * that guarantee no compression / no MIME ambiguity:
 *
 *   - `Content-Type: text/html; charset=utf-8`
 *   - `Content-Encoding: identity` (defensive — @fastify/compress is NOT
 *     registered anywhere in the server, but this header documents the
 *     byte-identity intent and acts as a belt-and-suspenders guard.)
 *
 * The actual file streaming is delegated to `reply.sendFile()`, decorated
 * onto the reply object by the `@fastify/static` plugin registered in
 * `src/server.ts` with `serve: false`.
 */

import type { FastifyInstance } from 'fastify';

import type { CatalogStore } from '../../catalog/store.js';

interface ArticleRouteOptions {
  store: CatalogStore;
  articlesDir: string;
}

const SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found — Agent News</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;background:#f4f6f9;color:#0b1e2e;min-height:100vh;display:grid;place-items:center;padding:32px}
.box{max-width:520px;text-align:center}
.eye{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#007a8a;margin-bottom:16px}
h1{font-family:'Newsreader',Georgia,serif;font-weight:500;font-size:clamp(40px,5vw,56px);line-height:1.05;letter-spacing:-.025em;margin:0 0 12px}
p{color:#5b6b80;font-size:16px;line-height:1.6;margin:0 0 24px}
a{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:7px;background:#0b1e2e;color:#f4f6f9;font-size:13.5px;font-weight:500;text-decoration:none;font-family:'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.04em}
a:hover{opacity:.9}
</style>
</head>
<body>
<div class="box">
<div class="eye">404 · Not found</div>
<h1>Article not found.</h1>
<p>That slug is not in the catalog. The article may have been unpublished or the URL may be wrong.</p>
<a href="/">← Back to catalog</a>
</div>
</body>
</html>
`;

export async function articleRoute(
  fastify: FastifyInstance,
  opts: ArticleRouteOptions,
): Promise<void> {
  const { store, articlesDir } = opts;

  fastify.get<{ Params: { slug: string } }>(
    '/a/:slug',
    async (request, reply) => {
      const { slug } = request.params;

      // 1. Validate slug format. Rejecting malformed slugs early prevents
      //    accidental filesystem probing and produces a consistent 404.
      if (typeof slug !== 'string' || !SLUG_REGEX.test(slug)) {
        return reply
          .code(404)
          .header('Content-Type', 'text/html; charset=utf-8')
          .send(NOT_FOUND_HTML);
      }

      // 2. Confirm the slug is present in the catalog. An article file may
      //    exist on disk before it is officially published — only catalog
      //    entries are publicly reachable.
      const entry = store.getBySlug(slug);
      if (entry === null) {
        return reply
          .code(404)
          .header('Content-Type', 'text/html; charset=utf-8')
          .send(NOT_FOUND_HTML);
      }

      // 3. Force the byte-identity-critical headers BEFORE sendFile so they
      //    are present on the outgoing response. `Content-Encoding: identity`
      //    documents the no-compression invariant explicitly.
      reply.header('Content-Type', 'text/html; charset=utf-8');
      reply.header('Content-Encoding', 'identity');

      // 4. Stream the file. `@fastify/static` (registered with
      //    `serve: false`) decorates `reply.sendFile`. The bytes flowing
      //    through `fs.createReadStream` are not transformed.
      return reply.sendFile(`${slug}.html`, articlesDir);
    },
  );
}
