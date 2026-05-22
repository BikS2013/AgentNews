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
<title>Not found</title>
</head>
<body>
<p>Article not found.</p>
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
