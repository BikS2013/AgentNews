/**
 * Catalog route — `GET /`.
 *
 * Reads a frozen snapshot of the catalog from the store, renders the
 * index HTML via the pure `renderCatalogHtml()` function, and returns it
 * with `Content-Type: text/html; charset=utf-8`.
 */

import type { FastifyInstance } from 'fastify';

import type { CatalogStore } from '../../catalog/store.js';
import { renderCatalogHtml } from '../render/catalog.js';

interface CatalogRouteOptions {
  store: CatalogStore;
}

export async function catalogRoute(
  fastify: FastifyInstance,
  opts: CatalogRouteOptions,
): Promise<void> {
  const { store } = opts;

  fastify.get('/', async (_request, reply) => {
    const entries = store.snapshot();
    const html = renderCatalogHtml(entries);
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return reply.code(200).send(html);
  });
}
