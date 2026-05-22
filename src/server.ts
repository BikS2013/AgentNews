/**
 * HTTP server entry point.
 *
 * IMPORTANT — Byte-identity guarantee:
 *
 *   `@fastify/compress` is intentionally NOT registered anywhere in this
 *   server. The article-publishing site's core invariant is that every
 *   `GET /a/:slug` response body is byte-identical to the file on disk
 *   (sha256(response.body) === sha256(file)). Registering the compress
 *   plugin — even globally with low intent — installs an `onSend` hook
 *   that GZIP/Brotli-encodes outgoing payloads, which would silently
 *   break that guarantee for every article.
 *
 *   If a future change ever introduces `@fastify/compress`, it MUST be
 *   registered in an encapsulated scope that does NOT include the
 *   article route, and the article route MUST continue to set
 *   `Content-Encoding: identity` as a defensive header.
 *
 *   `@fastify/static` is registered with `serve: false` so we own the
 *   routing — we expose only `GET /a/:slug` with explicit slug validation
 *   and catalog lookup. `etag: false` and `lastModified: false` keep the
 *   response simple for byte-identity verification (no 304 short-circuit
 *   for plain GETs, no conditional-GET handling at all). `contentType:
 *   false` removes the plugin's MIME detection so the route handler can
 *   set `Content-Type: text/html; charset=utf-8` explicitly.
 */

import path from 'node:path';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { CatalogStore } from './catalog/store.js';
import { loadConfig } from './config.js';
import { articleRoute } from './server/routes/article.js';
import { catalogRoute } from './server/routes/catalog.js';

export default async function start(): Promise<FastifyInstance> {
  const config = loadConfig();

  const store = new CatalogStore(config.catalogPath);
  await store.load();

  const fastify = Fastify({ logger: true });

  const articlesRoot = path.resolve(config.articlesDir);

  await fastify.register(fastifyStatic, {
    root: articlesRoot,
    // We expose explicit routes; the plugin only decorates reply.sendFile.
    serve: false,
    decorateReply: true,
    // No automatic MIME detection — the route handler sets Content-Type.
    contentType: false,
    // No ETag / Last-Modified — keeps byte-identity tests simple by
    // eliminating 304 short-circuits and conditional-GET semantics.
    etag: false,
    lastModified: false,
    // Defensive: never resolve directory indexes or list directories.
    index: false,
    // CRITICAL invariant: preCompressed would serve .br/.gz sidecars
    // instead of the source file, breaking byte-identity.
    preCompressed: false,
    // No auto Cache-Control — leave headers up to explicit route logic.
    cacheControl: false,
  });

  await fastify.register(async (scope) => {
    await articleRoute(scope, { store, articlesDir: articlesRoot });
  });

  await fastify.register(async (scope) => {
    await catalogRoute(scope, { store });
  });

  await fastify.listen({ port: config.port, host: '0.0.0.0' });

  return fastify;
}

// Auto-run when this module is the process entry point (e.g.
// `npx tsx src/server.ts`).
start().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
