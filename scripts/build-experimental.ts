#!/usr/bin/env tsx
/**
 * Static export builder for the EXPERIMENTAL sibling site.
 *
 * Mirror of `scripts/build-static.ts` but scoped to the experimental tree.
 *
 * Reads:
 *   - $EXPERIMENTAL_CATALOG_PATH (env var, required)
 *   - $EXPERIMENTAL_DIR          (env var, required — directory containing
 *                                 <slug>.html files)
 *   - $EXPERIMENTAL_LINKS_PATH   (env var, required — currently expected to
 *                                 point at an empty links manifest; mirrors
 *                                 the public build's `LINKS_PATH` so the
 *                                 catalog renderer signature stays unchanged)
 *   - $BASE_PATH                 (env var, required — e.g.
 *                                 "/<TARGET_REPO_NAME>" for a project Pages site)
 *   - $OUT_DIR                   (env var, required, conventionally
 *                                 "dist-experimental")
 *
 * Writes everything to $OUT_DIR:
 *   dist-experimental/index.html       — pre-rendered experimental catalog page.
 *   dist-experimental/a/<slug>.html    — byte-identical copy of every
 *                                        experimental article. Source SHA-256
 *                                        is verified against the manifest.
 *   dist-experimental/404.html         — styled 404 page.
 *   dist-experimental/.nojekyll        — Jekyll-skip marker for GitHub Pages.
 *
 * Single-reader guarantee: this script reads ONLY from
 * `EXPERIMENTAL_CATALOG_PATH` / `EXPERIMENTAL_DIR`. Any attempt to point it
 * at the public catalog (`catalog.json`) or the public articles tree
 * (`articles/`) is rejected with a fatal error before any file is touched.
 *
 * The script aborts on any byte-identity failure (source hash mismatch) so
 * a broken experimental catalog cannot ship.
 *
 * No fallback values for env vars — missing or empty → throw and exit 1.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
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
  const v = process.env[name];
  if (v === undefined) {
    throw new Error(
      `Missing required env var: ${name} (set "" for root host or e.g. "/<repo-name>")`,
    );
  }
  return v;
}

/**
 * Single-reader guard: refuse to run if the configured paths look like the
 * public flow's catalog/articles. This is symmetric with the
 * publish-experimental-article CLI's single-writer guard.
 */
function assertExperimentalTargets(
  catalogPath: string,
  articlesDir: string,
): void {
  const catalogBase = path.basename(path.resolve(catalogPath));
  if (!catalogBase.startsWith('experimental-')) {
    throw new Error(
      `EXPERIMENTAL_CATALOG_PATH must resolve to a file whose basename starts with "experimental-" (got "${catalogBase}"). Refusing to build a non-experimental manifest.`,
    );
  }
  const dirBase = path.basename(path.resolve(articlesDir));
  if (dirBase !== 'experimental') {
    throw new Error(
      `EXPERIMENTAL_DIR must resolve to a directory whose basename is exactly "experimental" (got "${dirBase}"). Refusing to build from a non-experimental tree.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Static 404 page (identical look & feel to the public build's 404)
// ---------------------------------------------------------------------------

const NOT_FOUND_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Not found — Agent News (experimental)</title>
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
<p>That slug is not in the experimental catalog. The article may have been unpublished or the URL may be wrong.</p>
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

function main(): number {
  const catalogPath = requireNonEmpty('EXPERIMENTAL_CATALOG_PATH');
  const articlesDir = requireNonEmpty('EXPERIMENTAL_DIR');
  const linksPath = requireNonEmpty('EXPERIMENTAL_LINKS_PATH');
  const basePath = requireBasePath('BASE_PATH');
  const outDir = requireNonEmpty('OUT_DIR');

  assertExperimentalTargets(catalogPath, articlesDir);

  const absCatalog = path.resolve(catalogPath);
  const absArticles = path.resolve(articlesDir);
  const absLinks = path.resolve(linksPath);
  const absOut = path.resolve(outDir);

  if (!existsSync(absCatalog)) {
    throw new Error(`EXPERIMENTAL_CATALOG_PATH does not exist: ${absCatalog}`);
  }
  if (!existsSync(absArticles)) {
    throw new Error(`EXPERIMENTAL_DIR does not exist: ${absArticles}`);
  }
  if (!existsSync(absLinks)) {
    throw new Error(`EXPERIMENTAL_LINKS_PATH does not exist: ${absLinks}`);
  }

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

  if (existsSync(absOut)) {
    rmSync(absOut, { recursive: true, force: true });
  }
  mkdirSync(absOut, { recursive: true });
  mkdirSync(path.join(absOut, 'a'), { recursive: true });

  // 1. Catalog page → <OUT_DIR>/index.html
  const catalogHtml = renderCatalogHtml(entries, { links, basePath });
  writeFileSync(path.join(absOut, 'index.html'), catalogHtml, 'utf8');

  // 2. Articles → <OUT_DIR>/a/<slug>.html (byte-identical, verified)
  let copied = 0;
  for (const entry of entries) {
    const src = path.join(absArticles, `${entry.slug}.html`);
    if (!existsSync(src)) {
      throw new Error(
        `Experimental article file missing on disk for catalog entry "${entry.slug}": ${src}`,
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

  // 3. 404 page
  const home = basePath === '' || basePath === '/' ? '/' : `${basePath}/`;
  writeFileSync(
    path.join(absOut, '404.html'),
    NOT_FOUND_HTML.replace('__HOME__', home),
    'utf8',
  );

  // 4. Bypass Jekyll
  writeFileSync(path.join(absOut, '.nojekyll'), '');

  process.stdout.write(
    `experimental static export OK — catalog + ${copied} article${copied === 1 ? '' : 's'} + ${links.length} link${links.length === 1 ? '' : 's'} written to ${absOut} (basePath="${basePath}")\n`,
  );
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`BUILD_EXPERIMENTAL_FAILED: ${msg}\n`);
  process.exit(1);
}
