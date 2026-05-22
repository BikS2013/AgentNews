/**
 * Pure HTML renderer for the catalog index page (`GET /`).
 *
 * Produces a complete `<!DOCTYPE html>` document combining two content
 * sections:
 *
 *   1. "Latest deep dives" — self-hosted, byte-identical HTML articles
 *      backed by `CatalogEntry` records, links go to `/a/<slug>` on this
 *      site.
 *   2. "From around the web" — curated external article links backed by
 *      `LinkEntry` records, links open in a new tab to the third-party
 *      publisher.
 *
 * Visual treatment follows the "Agent News" design system (IBM Plex Sans
 * + Newsreader serif + IBM Plex Mono accents, cool-teal `#007a8a` on
 * off-white). Every string injected into the HTML is escaped via
 * `escapeHtml` to prevent any field from being interpreted as markup.
 *
 * IMPORTANT: This renderer styles ONLY the catalog index. Individual
 * article pages (`GET /a/:slug`) are served byte-identically from disk
 * and are never altered by this site.
 */

import type { CatalogEntry } from '../../catalog/types.js';
import type { LinkEntry } from '../../links/types.js';

/**
 * Escape the five XML/HTML metacharacters so that arbitrary catalog
 * strings (title, slug, date, URL) cannot break out of their attribute
 * or text context.
 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format an ISO-8601 timestamp as `YYYY-MM-DD UTC` for display on cards. */
function formatPublishedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd} UTC`;
}

const STYLES = `
  :root {
    --bg:          #f4f6f9;
    --bg-2:        #eef2f7;
    --surface:     #ffffff;
    --surface-2:   #f8fafc;
    --ink:         #0b1e2e;
    --ink-2:       #1a3148;
    --muted:       #5b6b80;
    --muted-2:     #8392a6;
    --border:      #dce3eb;
    --hairline:    #ebeff5;
    --accent:      #007a8a;
    --accent-ink:  #00525c;
    --accent-soft: #e0f2f4;
    --radius-sm: 6px;
    --radius:    10px;
    --radius-lg: 16px;
    --shadow-md: 0 4px 18px -8px rgba(11,30,46,.18), 0 0 0 1px rgba(11,30,46,.05);
  }

  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
    font-size: 16px;
    line-height: 1.55;
    background: var(--bg);
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  img, svg { display: block; max-width: 100%; }
  a { color: inherit; text-decoration: none; }

  .wrap { max-width: 1240px; margin: 0 auto; padding: 0 32px; }
  @media (max-width: 720px) { .wrap { padding: 0 20px; } }

  /* ---------- HEADER ---------- */
  .site-header {
    position: sticky; top: 0; z-index: 50;
    background: rgba(244,246,249,.82);
    backdrop-filter: saturate(180%) blur(14px);
    -webkit-backdrop-filter: saturate(180%) blur(14px);
    border-bottom: 1px solid var(--hairline);
  }
  .site-header__inner {
    display: flex; align-items: center; gap: 28px;
    height: 64px;
  }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 600; letter-spacing: -.02em; }
  .brand__mark {
    width: 28px; height: 28px; border-radius: 7px;
    background: var(--ink); color: var(--bg);
    display: grid; place-items: center;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 14px; font-weight: 600;
  }
  .brand__name { font-size: 16px; color: var(--ink); }
  .brand__name span { color: var(--muted); font-weight: 400; }

  .nav { display: flex; gap: 4px; margin-left: 8px; }
  .nav a {
    padding: 8px 12px; border-radius: 6px;
    font-size: 14px; color: var(--ink-2);
    transition: background .15s, color .15s;
  }
  .nav a:hover { background: var(--surface-2); color: var(--ink); }
  .nav a.active { color: var(--accent); }

  .header-actions { margin-left: auto; display: flex; align-items: center; gap: 4px; }
  .search-trigger {
    display: flex; align-items: center; gap: 8px;
    padding: 7px 10px 7px 12px; border-radius: 8px;
    background: var(--surface-2);
    border: 1px solid var(--hairline);
    color: var(--muted);
    font-size: 13px;
    min-width: 220px;
  }
  .kbd {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    padding: 2px 6px; border-radius: 4px;
    background: var(--bg);
    border: 1px solid var(--hairline);
    color: var(--muted);
    line-height: 1;
    margin-left: auto;
  }
  @media (max-width: 920px) {
    .search-trigger { min-width: 0; }
    .search-trigger span:not(.kbd) { display: none; }
    .nav { display: none; }
  }

  /* ---------- HERO ---------- */
  .hero {
    padding: 56px 0 40px;
    border-bottom: 1px solid var(--hairline);
  }
  .hero__intro {
    display: grid; grid-template-columns: 2fr 1fr; gap: 80px;
  }
  .hero__title {
    font-family: 'Newsreader', Georgia, serif;
    font-weight: 500;
    font-size: clamp(40px, 5vw, 64px);
    line-height: 1.05;
    letter-spacing: -.025em;
    color: var(--ink);
  }
  .hero__title em { font-style: italic; color: var(--accent); font-weight: 500; }
  .hero__lede {
    font-size: 16px; color: var(--muted); line-height: 1.6;
    max-width: 360px;
  }
  .hero__lede small {
    display: block; margin-top: 16px;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
    color: var(--muted);
  }
  @media (max-width: 880px) {
    .hero__intro { grid-template-columns: 1fr; gap: 24px; }
  }

  /* ---------- SECTION ---------- */
  .section { padding: 56px 0; border-bottom: 1px solid var(--hairline); }
  .section:last-of-type { border-bottom: 0; }
  .section__head {
    display: flex; align-items: baseline; justify-content: space-between;
    margin-bottom: 32px;
  }
  .section__head h2 {
    font-size: 14px;
    font-family: 'IBM Plex Mono', monospace;
    text-transform: uppercase; letter-spacing: .14em;
    color: var(--muted);
    font-weight: 500;
    margin: 0;
  }
  .section__head .count {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    color: var(--ink-2);
  }

  /* ---------- FEATURE (lead story) ---------- */
  .feature {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 56px;
    align-items: center;
  }
  .feature__art {
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface-2);
    aspect-ratio: 16 / 9;
  }
  .feature__art img { width: 100%; height: 100%; object-fit: cover; }
  .feature__body { display: flex; flex-direction: column; gap: 18px; }
  .feature__meta {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  }
  .feature__title {
    font-family: 'Newsreader', Georgia, serif;
    font-weight: 500;
    font-size: clamp(28px, 3vw, 40px);
    line-height: 1.1;
    letter-spacing: -.02em;
    color: var(--ink);
  }
  .feature__title:hover { color: var(--accent); }
  .feature__cta {
    align-self: flex-start;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 13px;
    color: var(--accent);
    border-bottom: 1px solid var(--accent);
    padding-bottom: 2px;
  }
  @media (max-width: 880px) {
    .feature { grid-template-columns: 1fr; gap: 24px; }
  }

  /* ---------- CARD GRID ---------- */
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 40px 32px; }
  @media (max-width: 880px) { .grid-3 { grid-template-columns: 1fr; } }

  .card { display: flex; flex-direction: column; gap: 16px; }
  .card__art {
    display: block;
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--surface-2);
    aspect-ratio: 16 / 9;
  }
  .card__art img { width: 100%; height: 100%; object-fit: cover; }
  .card__body { display: flex; flex-direction: column; gap: 10px; }
  .card__meta {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  }
  .card__title {
    font-size: 22px; line-height: 1.2; font-weight: 600;
    letter-spacing: -.015em;
    color: var(--ink);
    margin: 0;
  }
  .card__title a { color: inherit; }
  .card__title a:hover { color: var(--accent); }
  .card__summary {
    color: var(--muted);
    font-size: 14.5px;
    line-height: 1.55;
    margin: 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* eyebrow / tag / dot — mono accents */
  .eyebrow {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    letter-spacing: .12em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 500;
  }
  .eyebrow.accent { color: var(--accent); }
  .tag {
    display: inline-flex; align-items: center;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px; letter-spacing: .04em;
    padding: 4px 9px; border-radius: 999px;
    background: var(--surface-2);
    border: 1px solid var(--hairline);
    color: var(--ink-2);
  }
  .tag.tag--link {
    color: var(--accent);
    border-color: var(--accent-soft);
    background: var(--accent-soft);
  }
  .external-host {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    letter-spacing: .04em;
    display: inline-flex; align-items: center; gap: 4px;
  }
  .external-host svg { color: var(--muted-2); }
  .dot { width: 3px; height: 3px; border-radius: 50%; background: var(--muted-2); }

  /* dual date block (video upload date + site publish date) */
  .dates {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    margin: 4px 0 2px;
  }
  .date-item {
    display: inline-flex; align-items: baseline; gap: 6px;
    font-family: 'IBM Plex Mono', monospace;
  }
  .date-label {
    font-size: 10px; letter-spacing: .12em; text-transform: uppercase;
    color: var(--muted);
    font-weight: 500;
  }
  .date-value {
    font-size: 12px; color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }
  .feature .dates .date-value { font-size: 13px; }

  /* ---------- EMPTY STATE ---------- */
  .empty {
    text-align: center;
    padding: 80px 24px;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .empty__eyebrow {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
    color: var(--accent);
    margin-bottom: 12px;
  }
  .empty__title {
    font-family: 'Newsreader', Georgia, serif;
    font-weight: 500;
    font-size: 28px;
    letter-spacing: -.015em;
    margin: 0 0 8px;
    color: var(--ink);
  }
  .empty__body { color: var(--muted); font-size: 15px; max-width: 480px; margin: 0 auto; }

  /* ---------- FOOTER ---------- */
  .site-footer {
    padding: 56px 0 32px;
    border-top: 1px solid var(--hairline);
    background: var(--surface-2);
  }
  .footer-grid {
    display: grid;
    grid-template-columns: 2fr repeat(3, 1fr);
    gap: 48px;
    padding-bottom: 32px;
  }
  .footer-grid h4 {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px; letter-spacing: .12em; text-transform: uppercase;
    color: var(--muted);
    font-weight: 500;
    margin: 0 0 14px;
  }
  .footer-grid ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
  .footer-grid a { font-size: 14px; color: var(--ink-2); }
  .footer-grid a:hover { color: var(--accent); }
  .footer-grid p {
    font-size: 14px; color: var(--muted); line-height: 1.55;
    max-width: 280px; margin: 12px 0 0;
  }
  .site-footer__bottom {
    display: flex; justify-content: space-between; align-items: center;
    padding-top: 24px;
    border-top: 1px solid var(--hairline);
    font-family: 'IBM Plex Mono', monospace;
    font-size: 11px; color: var(--muted);
    letter-spacing: .04em;
  }
  @media (max-width: 880px) {
    .footer-grid { grid-template-columns: 1fr 1fr; }
  }
`.trim();

const FONT_LINKS = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap" rel="stylesheet">
`.trim();

const SEARCH_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m21 21-4.3-4.3"></path></svg>';

const EXTERNAL_ICON = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"></path><path d="M7 7h10v10"></path></svg>';

function renderHeader(bp: string): string {
  const home = `${bp}/`;
  const articlesAnchor = `${home}#from-around-the-web`;
  return `
<header class="site-header">
  <div class="wrap site-header__inner">
    <a href="${home}" class="brand">
      <span class="brand__mark">A</span>
      <span class="brand__name">Agent News</span>
    </a>
    <nav class="nav" aria-label="Primary">
      <a href="${home}" class="active">Latest</a>
      <a href="${articlesAnchor}">Articles</a>
      <a href="${home}">Topics</a>
      <a href="${home}">About</a>
    </nav>
    <div class="header-actions">
      <div class="search-trigger" role="search" aria-label="Search articles">
        ${SEARCH_ICON}
        <span>Search articles</span>
        <span class="kbd">⌘K</span>
      </div>
    </div>
  </div>
</header>
`.trim();
}

function renderFooter(bp: string): string {
  const home = `${bp}/`;
  return `
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <a href="${home}" class="brand">
          <span class="brand__mark">A</span>
          <span class="brand__name">Agent News</span>
        </a>
        <p>Deep dives on the agent stack — and a curated stream of the best writing on agents from around the web.</p>
      </div>
      <div>
        <h4>Read</h4>
        <ul>
          <li><a href="${home}">Latest</a></li>
          <li><a href="${home}#from-around-the-web">Articles</a></li>
          <li><a href="${home}">Topics</a></li>
        </ul>
      </div>
      <div>
        <h4>Publication</h4>
        <ul>
          <li><a href="${home}">About</a></li>
          <li><a href="${home}">Authors</a></li>
          <li><a href="${home}">Subscribe</a></li>
        </ul>
      </div>
      <div>
        <h4>Connect</h4>
        <ul>
          <li><a href="${home}">RSS</a></li>
          <li><a href="${home}">GitHub</a></li>
          <li><a href="${home}">Contact</a></li>
        </ul>
      </div>
    </div>
    <div class="site-footer__bottom">
      <span>© 2026 AGENT NEWS</span>
      <span>BUILT AS A BYTE-FIDELITY CONTENT PLATFORM</span>
    </div>
  </div>
</footer>
`.trim();
}

/**
 * Sort key for video catalog entries: prefer YouTube upload date when known,
 * fall back to site publish date.
 */
function sortKey(entry: CatalogEntry): string {
  return entry.youtubePublishedAt ?? entry.publishedAt;
}

/** Normalise a base path for project-page deploys. */
function normalizeBasePath(basePath: string): string {
  if (basePath === '' || basePath === '/') return '';
  let bp = basePath;
  if (!bp.startsWith('/')) bp = '/' + bp;
  if (bp.endsWith('/')) bp = bp.slice(0, -1);
  return bp;
}

export interface RenderCatalogOptions {
  /** External-article entries to render in the "From around the web" section. Optional. */
  links?: readonly LinkEntry[];
  /** URL prefix for internal links (project-page deploy). Default empty. */
  basePath?: string;
}

/**
 * Render the full catalog HTML page.
 *
 * @param entries Self-hosted video deep-dive entries.
 * @param options Optional links (external articles) and basePath.
 */
export function renderCatalogHtml(
  entries: readonly CatalogEntry[],
  options: RenderCatalogOptions = {},
): string {
  const bp = normalizeBasePath(options.basePath ?? '');
  const links = options.links ?? [];

  // --- Videos: sort newest-first by YouTube date, fallback to site date ---
  const sortedVideos = entries.slice().sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    if (ka < kb) return 1;
    if (ka > kb) return -1;
    if (a.publishedAt < b.publishedAt) return 1;
    if (a.publishedAt > b.publishedAt) return -1;
    return 0;
  });

  // --- Links: sort newest-first by publishedAt ---
  const sortedLinks = links.slice().sort((a, b) => {
    if (a.publishedAt < b.publishedAt) return 1;
    if (a.publishedAt > b.publishedAt) return -1;
    return 0;
  });

  const videoCount = sortedVideos.length;
  const linkCount = sortedLinks.length;
  const videoCountLabel = `${videoCount} article${videoCount === 1 ? '' : 's'} published`;
  const linkCountLabel = `${linkCount} link${linkCount === 1 ? '' : 's'} curated`;

  // --- Body assembly ---
  let body: string;
  if (videoCount === 0 && linkCount === 0) {
    body = renderEmptyAll();
  } else {
    const videoSection = videoCount === 0 ? '' : renderVideosSection(sortedVideos, videoCountLabel, bp);
    const linksSection = linkCount === 0 ? '' : renderLinksSection(sortedLinks, linkCountLabel);
    body = videoSection + linksSection;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent News</title>
<meta name="description" content="Agent News — deep dives on the agent stack and curated articles from around the web. ${escapeHtml(videoCountLabel)}, ${escapeHtml(linkCountLabel)}.">
${FONT_LINKS}
<style>
${STYLES}
</style>
</head>
<body>
${renderHeader(bp)}
<main>
${body}
</main>
${renderFooter(bp)}
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

function renderVideosSection(
  videos: readonly CatalogEntry[],
  countLabel: string,
  bp: string,
): string {
  const [lead, ...rest] = videos;
  const featureSection = lead === undefined ? '' : renderFeature(lead, bp);
  const restSection =
    rest.length === 0
      ? ''
      : `
<section class="section">
  <div class="wrap">
    <div class="section__head">
      <h2>More recent</h2>
      <span class="count">${escapeHtml(countLabel)}</span>
    </div>
    <div class="grid-3">
${rest.map((e) => renderCard(e, bp)).join('\n')}
    </div>
  </div>
</section>`;
  return featureSection + restSection;
}

function renderDates(entry: CatalogEntry): string {
  const site = escapeHtml(formatPublishedAt(entry.publishedAt));
  if (entry.youtubePublishedAt === undefined) {
    return `        <div class="dates">
          <span class="date-item"><span class="date-label">Published</span><span class="date-value">${site}</span></span>
        </div>`;
  }
  const yt = escapeHtml(formatPublishedAt(entry.youtubePublishedAt));
  return `        <div class="dates">
          <span class="date-item"><span class="date-label">Video</span><span class="date-value">${yt}</span></span>
          <span class="dot"></span>
          <span class="date-item"><span class="date-label">Published</span><span class="date-value">${site}</span></span>
        </div>`;
}

function renderFeature(entry: CatalogEntry, bp: string): string {
  const slug = escapeHtml(entry.slug);
  const title = escapeHtml(entry.title);
  const thumb = escapeHtml(entry.thumbnailUrl);
  const siteDate = escapeHtml(formatPublishedAt(entry.publishedAt));
  const ytDate =
    entry.youtubePublishedAt === undefined
      ? null
      : escapeHtml(formatPublishedAt(entry.youtubePublishedAt));
  const headDate = ytDate ?? siteDate;
  const href = `${bp}/a/${slug}`;
  return `
<section class="hero">
  <div class="wrap">
    <div class="hero__intro">
      <h1 class="hero__title">News from the <em>agent stack.</em></h1>
      <p class="hero__lede">
        Long-form deep dives on the tools, techniques, and frameworks shaping how engineers build with agents — and a curated stream of the best writing from around the web.
        <small>Updated ${siteDate}</small>
      </p>
    </div>
  </div>
</section>
<section class="section">
  <div class="wrap">
    <div class="section__head">
      <h2>Lead story</h2>
      <span class="count">${headDate}</span>
    </div>
    <article class="feature">
      <a href="${href}" class="feature__art" aria-label="${title}">
        <img src="${thumb}" alt="${title}" loading="lazy" decoding="async">
      </a>
      <div class="feature__body">
        <div class="feature__meta">
          <span class="eyebrow accent">Deep dive</span>
        </div>
${renderDates(entry)}
        <h2 class="feature__title"><a href="${href}">${title}</a></h2>
        <a href="${href}" class="feature__cta">Read article →</a>
      </div>
    </article>
  </div>
</section>`.trim();
}

function renderCard(entry: CatalogEntry, bp: string): string {
  const slug = escapeHtml(entry.slug);
  const title = escapeHtml(entry.title);
  const thumb = escapeHtml(entry.thumbnailUrl);
  const href = `${bp}/a/${slug}`;
  return `      <article class="card">
        <a href="${href}" class="card__art" aria-label="${title}">
          <img src="${thumb}" alt="${title}" loading="lazy" decoding="async">
        </a>
        <div class="card__body">
          <div class="card__meta">
            <span class="tag">Deep dive</span>
          </div>
${renderDates(entry)}
          <h3 class="card__title"><a href="${href}">${title}</a></h3>
        </div>
      </article>`;
}

// ---------------------------------------------------------------------------
// External links
// ---------------------------------------------------------------------------

function renderLinksSection(
  links: readonly LinkEntry[],
  countLabel: string,
): string {
  return `
<section class="section" id="from-around-the-web">
  <div class="wrap">
    <div class="section__head">
      <h2>From around the web</h2>
      <span class="count">${escapeHtml(countLabel)}</span>
    </div>
    <div class="grid-3">
${links.map(renderLinkCard).join('\n')}
    </div>
  </div>
</section>`.trim();
}

function renderLinkCard(entry: LinkEntry): string {
  const title = escapeHtml(entry.title);
  const url = escapeHtml(entry.url);
  const image = escapeHtml(entry.imageUrl);
  const host = escapeHtml(entry.sourceSite);
  const date = escapeHtml(formatPublishedAt(entry.publishedAt));
  const summary =
    entry.summary !== undefined && entry.summary.length > 0
      ? `\n          <p class="card__summary">${escapeHtml(entry.summary)}</p>`
      : '';
  return `      <article class="card">
        <a href="${url}" class="card__art" target="_blank" rel="noopener noreferrer" aria-label="${title}">
          <img src="${image}" alt="${title}" loading="lazy" decoding="async">
        </a>
        <div class="card__body">
          <div class="card__meta">
            <span class="tag tag--link">Article</span>
            <span class="external-host">${EXTERNAL_ICON}${host}</span>
          </div>
          <div class="dates">
            <span class="date-item"><span class="date-label">Published</span><span class="date-value">${date}</span></span>
          </div>
          <h3 class="card__title"><a href="${url}" target="_blank" rel="noopener noreferrer">${title}</a></h3>${summary}
        </div>
      </article>`;
}

// ---------------------------------------------------------------------------
// Empty state (both videos and links empty)
// ---------------------------------------------------------------------------

function renderEmptyAll(): string {
  return `
<section class="section">
  <div class="wrap">
    <div class="empty">
      <div class="empty__eyebrow">0 articles published</div>
      <h2 class="empty__title">No articles yet.</h2>
      <p class="empty__body">Publish a deep dive with <code>npm run publish-article -- --source &lt;path&gt;</code> or curate a third-party article with <code>npm run publish-link -- --url &lt;URL&gt;</code> and reload.</p>
    </div>
  </div>
</section>`.trim();
}
