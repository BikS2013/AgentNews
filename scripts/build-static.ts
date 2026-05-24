#!/usr/bin/env tsx
/**
 * Static export builder for GitHub Pages (or any static host).
 *
 * Reads:
 *   - $CATALOG_PATH (env var, required — same env var as the live server)
 *   - $ARTICLES_DIR (env var, required — directory containing <slug>.html files)
 *   - $BASE_PATH    (env var, required — "" for root host, "/AgentNews" for a
 *                    GitHub Pages project page at /<repo>/)
 *
 * Writes everything to $OUT_DIR (env var, required; conventionally "dist"):
 *   dist/index.html          — pre-rendered catalog page (byte-identical to
 *                              what the live server would emit for `GET /`,
 *                              modulo the basePath in internal hrefs).
 *   dist/a/<slug>.html       — byte-identical copy of every article. We copy
 *                              by Buffer (not by text) and verify SHA-256
 *                              against the catalog entry's stored hash.
 *   dist/404.html            — an Agent-News-styled 404 page (matches the live
 *                              server's article-not-found page).
 *   dist/.nojekyll           — empty marker that tells GitHub Pages to skip
 *                              its Jekyll processing pass, guaranteeing
 *                              that the article files are served exactly
 *                              as committed (no Liquid templating, no HTML
 *                              minification).
 *
 * The script aborts on any byte-identity failure (source hash mismatch) so
 * a broken catalog cannot ship.
 *
 * No fallback values for env vars — missing or empty → throw and exit 1.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';

import { isCatalogFile } from '../src/catalog/types.js';
import type { CatalogEntry } from '../src/catalog/types.js';
import { isLinksFile } from '../src/links/types.js';
import type { LinkEntry } from '../src/links/types.js';
import { renderCatalogHtml } from '../src/server/render/catalog.js';

// ---------------------------------------------------------------------------
// Config (no fallbacks — every required env var must be set)
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function requireNonEmpty(name: string): string {
  const v = requireEnv(name);
  if (v.length === 0) {
    throw new Error(`Required env var ${name} must not be empty`);
  }
  return v;
}

function requireBasePath(name: string): string {
  // BASE_PATH is the only "may be empty" required env var — empty means
  // "host at root". Force the caller to set it explicitly anyway.
  const v = process.env[name];
  if (v === undefined) {
    throw new Error(`Missing required env var: ${name} (set "" for root host or e.g. "/AgentNews")`);
  }
  return v;
}

// ---------------------------------------------------------------------------
// Static 404 page
// ---------------------------------------------------------------------------

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found — Agent News</title>
<script>
(function(){try{var s=localStorage.getItem('agent-news-theme');if(s==='light'||s==='dark'){document.documentElement.setAttribute('data-theme',s);}}catch(e){}})();
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,500&display=swap" rel="stylesheet">
<style>
:root{--bg:#f4f6f9;--ink:#0b1e2e;--muted:#5b6b80;--accent:#007a8a;--btn-bg:#0b1e2e;--btn-ink:#f4f6f9}
:root[data-theme="dark"]{--bg:#0b1419;--ink:#e6edf3;--muted:#8b9aab;--accent:#2dd4bf;--btn-bg:#2dd4bf;--btn-ink:#0b1419;color-scheme:dark}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#0b1419;--ink:#e6edf3;--muted:#8b9aab;--accent:#2dd4bf;--btn-bg:#2dd4bf;--btn-ink:#0b1419;color-scheme:dark}}
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:'IBM Plex Sans',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;display:grid;place-items:center;padding:32px}
.box{max-width:520px;text-align:center}
.eye{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);margin-bottom:16px}
h1{font-family:'Newsreader',Georgia,serif;font-weight:500;font-size:clamp(40px,5vw,56px);line-height:1.05;letter-spacing:-.025em;margin:0 0 12px}
p{color:var(--muted);font-size:16px;line-height:1.6;margin:0 0 24px}
a{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:7px;background:var(--btn-bg);color:var(--btn-ink);font-size:13.5px;font-weight:500;text-decoration:none;font-family:'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.04em}
a:hover{opacity:.9}
</style>
</head>
<body>
<div class="box">
<div class="eye">404 · Not found</div>
<h1>Article not found.</h1>
<p>That slug is not in the catalog. The article may have been unpublished or the URL may be wrong.</p>
<a href="__HOME__">← Back to catalog</a>
</div>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Minimal HTML attribute-value escape — used only for the optional
 *  experimental-URL attribute in the hero link. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function main(): number {
  const catalogPath = requireNonEmpty('CATALOG_PATH');
  const articlesDir = requireNonEmpty('ARTICLES_DIR');
  const linksPath = requireNonEmpty('LINKS_PATH');
  const basePath = requireBasePath('BASE_PATH');
  const outDir = requireNonEmpty('OUT_DIR');
  // Optional. When set to a non-empty URL the public hero gains a discreet
  // extra line linking to the experimental sibling site. Empty / unset →
  // no link rendered (matches the pre-feature look). Feature-gated rather
  // than required so local `npm run dev` shows the unadorned hero by
  // default; the deploy.yml workflow sets it for the deployed public site.
  const experimentalUrl = (process.env['EXPERIMENTAL_URL'] ?? '').trim();

  const absCatalog = path.resolve(catalogPath);
  const absArticles = path.resolve(articlesDir);
  const absLinks = path.resolve(linksPath);
  const absOut = path.resolve(outDir);

  if (!existsSync(absCatalog)) {
    throw new Error(`CATALOG_PATH does not exist: ${absCatalog}`);
  }
  if (!existsSync(absArticles)) {
    throw new Error(`ARTICLES_DIR does not exist: ${absArticles}`);
  }
  if (!existsSync(absLinks)) {
    throw new Error(`LINKS_PATH does not exist: ${absLinks}`);
  }

  // Parse + validate the catalog.
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absCatalog, 'utf8'));
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to parse ${absCatalog} as JSON: ${msg}`);
  }
  if (!isCatalogFile(parsed)) {
    throw new Error(`${absCatalog} does not match the expected catalog schema`);
  }
  const entries: CatalogEntry[] = parsed.entries;

  // Parse + validate the links file.
  let parsedLinks: unknown;
  try {
    parsedLinks = JSON.parse(readFileSync(absLinks, 'utf8'));
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to parse ${absLinks} as JSON: ${msg}`);
  }
  if (!isLinksFile(parsedLinks)) {
    throw new Error(`${absLinks} does not match the expected links schema`);
  }
  const links: LinkEntry[] = parsedLinks.entries;

  // Reset the output directory so stale entries can't ship.
  if (existsSync(absOut)) {
    rmSync(absOut, { recursive: true, force: true });
  }
  mkdirSync(absOut, { recursive: true });
  mkdirSync(path.join(absOut, 'a'), { recursive: true });

  // 1. Catalog page → dist/index.html
  //    If EXPERIMENTAL_URL is set, surface a discreet link to the
  //    experimental sibling site at the bottom of the hero lede. Otherwise
  //    render the unadorned hero (no link).
  const heroExtraHtml =
    experimentalUrl.length > 0
      ? `<a href="${escapeAttr(experimentalUrl)}">+ a path to experiments</a>`
      : undefined;
  const catalogHtml = renderCatalogHtml(entries, {
    links,
    basePath,
    ...(heroExtraHtml !== undefined ? { heroExtraHtml } : {}),
  });
  writeFileSync(path.join(absOut, 'index.html'), catalogHtml, 'utf8');

  // 2. Articles → dist/a/<slug>.html (byte-identical, verified)
  let copied = 0;
  for (const entry of entries) {
    const src = path.join(absArticles, `${entry.slug}.html`);
    if (!existsSync(src)) {
      throw new Error(
        `Article file missing on disk for catalog entry "${entry.slug}": ${src}`,
      );
    }
    const buf = readFileSync(src);
    const actualHash = sha256Hex(buf);
    if (actualHash !== entry.sha256) {
      throw new Error(
        `SHA-256 mismatch for "${entry.slug}": catalog ${entry.sha256}, disk ${actualHash}`,
      );
    }
    writeFileSync(path.join(absOut, 'a', `${entry.slug}.html`), buf);
    copied += 1;
  }

  // 3. Thumbnails → dist/articles/thumbnails/ (local thumbnail files)
  const thumbsDir = path.join(absArticles, 'thumbnails');
  const outThumbsDir = path.join(absOut, 'articles', 'thumbnails');
  let thumbsCopied = 0;
  if (existsSync(thumbsDir)) {
    mkdirSync(outThumbsDir, { recursive: true });
    for (const file of readdirSync(thumbsDir)) {
      const src = path.join(thumbsDir, file);
      if (statSync(src).isFile()) {
        writeFileSync(path.join(outThumbsDir, file), readFileSync(src));
        thumbsCopied += 1;
      }
    }
  }

  // 4. 404 page → dist/404.html (with the home link resolved to the basePath)
  const home = basePath === '' || basePath === '/' ? '/' : `${basePath}/`;
  writeFileSync(
    path.join(absOut, '404.html'),
    NOT_FOUND_HTML.replace('__HOME__', home),
    'utf8',
  );

  // 5. Bypass GitHub Pages' Jekyll processing so files ship byte-for-byte.
  writeFileSync(path.join(absOut, '.nojekyll'), '');

  // Summary to stdout.
  process.stdout.write(
    `static export OK — catalog + ${copied} article${copied === 1 ? '' : 's'} + ${links.length} link${links.length === 1 ? '' : 's'} + ${thumbsCopied} thumbnail${thumbsCopied === 1 ? '' : 's'} written to ${absOut} (basePath="${basePath}")\n`,
  );
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`BUILD_STATIC_FAILED: ${msg}\n`);
  process.exit(1);
}
