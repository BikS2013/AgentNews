/**
 * Catalog route — `GET /`.
 *
 * Reads frozen snapshots of the catalog AND links stores, renders the
 * index HTML via the pure `renderCatalogHtml()` function, and returns it
 * with `Content-Type: text/html; charset=utf-8`.
 */

import type { FastifyInstance } from 'fastify';

import type { CatalogStore } from '../../catalog/store.js';
import type { LinksStore } from '../../links/store.js';
import { renderCatalogHtml } from '../render/catalog.js';

interface CatalogRouteOptions {
  store: CatalogStore;
  linksStore: LinksStore;
}

export async function catalogRoute(
  fastify: FastifyInstance,
  opts: CatalogRouteOptions,
): Promise<void> {
  const { store, linksStore } = opts;

  fastify.get('/', async (_request, reply) => {
    const entries = store.snapshot();
    const links = linksStore.snapshot();
    const html = renderCatalogHtml(entries, { links });
    reply.header('Content-Type', 'text/html; charset=utf-8');
    return reply.code(200).send(html);
  });
}
