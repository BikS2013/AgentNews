/**
 * Pure HTML renderer for the catalog index page (`GET /`).
 *
 * Produces a complete `<!DOCTYPE html>` document listing every published
 * article as a card (thumbnail + title link + publication date), sorted
 * by `publishedAt` descending (newest first).
 *
 * Every string injected into the HTML is escaped via `escapeHtml` to
 * prevent any catalog field from being interpreted as markup. No runtime
 * dependencies; no I/O.
 */

import type { CatalogEntry } from '../../catalog/types.js';

/**
 * Escape the five XML/HTML metacharacters so that arbitrary catalog
 * strings (title, slug, date, thumbnail URL) cannot break out of their
 * attribute or text context.
 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format an ISO-8601 timestamp as `YYYY-MM-DD UTC` for display on cards.
 * Falls back to the raw input if it cannot be parsed (shouldn't happen
 * for validated CatalogEntry values, but keeps the renderer robust).
 */
function formatPublishedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd} UTC`;
}

const STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 2rem 1.25rem;
    background: #0f1115;
    color: #e7e9ee;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.5;
  }
  header {
    max-width: 1200px;
    margin: 0 auto 2rem;
  }
  h1 {
    font-size: 1.75rem;
    margin: 0 0 0.25rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  header p {
    margin: 0;
    color: #9aa0ac;
    font-size: 0.95rem;
  }
  main {
    max-width: 1200px;
    margin: 0 auto;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1.25rem;
  }
  .card {
    background: #181b22;
    border: 1px solid #232733;
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: border-color 0.15s ease, transform 0.15s ease;
  }
  .card:hover {
    border-color: #3a4153;
    transform: translateY(-2px);
  }
  .card img {
    display: block;
    width: 100%;
    height: 160px;
    object-fit: cover;
    background: #0f1115;
  }
  .card-body {
    padding: 0.9rem 1rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    flex: 1;
  }
  .card-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.35;
  }
  .card-title a {
    color: #e7e9ee;
    text-decoration: none;
  }
  .card-title a:hover { text-decoration: underline; }
  .card-date {
    margin: 0;
    font-size: 0.8rem;
    color: #9aa0ac;
    font-variant-numeric: tabular-nums;
  }
  .empty {
    text-align: center;
    color: #9aa0ac;
    padding: 4rem 1rem;
    border: 1px dashed #232733;
    border-radius: 10px;
  }
`.trim();

/**
 * Render the full catalog HTML page.
 */
export function renderCatalogHtml(entries: readonly CatalogEntry[]): string {
  // Sort newest first. Copy first — input is `readonly`.
  const sorted = entries.slice().sort((a, b) => {
    if (a.publishedAt < b.publishedAt) return 1;
    if (a.publishedAt > b.publishedAt) return -1;
    return 0;
  });

  const body =
    sorted.length === 0
      ? '<p class="empty">No articles published yet.</p>'
      : `<div class="grid">\n${sorted.map(renderCard).join('\n')}\n</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Article Catalog</title>
<style>
${STYLES}
</style>
</head>
<body>
<header>
<h1>Article Catalog</h1>
<p>${sorted.length} article${sorted.length === 1 ? '' : 's'} published</p>
</header>
<main>
${body}
</main>
</body>
</html>
`;
}

function renderCard(entry: CatalogEntry): string {
  const slug = escapeHtml(entry.slug);
  const title = escapeHtml(entry.title);
  const thumb = escapeHtml(entry.thumbnailUrl);
  const date = escapeHtml(formatPublishedAt(entry.publishedAt));
  return `  <article class="card">
    <a href="/a/${slug}" aria-label="${title}">
      <img src="${thumb}" alt="${title}" loading="lazy" decoding="async">
    </a>
    <div class="card-body">
      <h2 class="card-title"><a href="/a/${slug}">${title}</a></h2>
      <p class="card-date">${date}</p>
    </div>
  </article>`;
}
