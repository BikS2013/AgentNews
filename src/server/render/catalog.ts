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

import {
  DEFAULT_CATALOG_CATEGORY,
  type CatalogEntry,
} from '../../catalog/types.js';
import {
  DEFAULT_LINK_CATEGORY,
  type LinkEntry,
} from '../../links/types.js';

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
  const aiNewsAnchor = `${home}#ai-news`;
  const deepDivesAnchor = `${home}#deep-dives`;
  const articlesAnchor = `${home}#articles`;
  return `
<header class="site-header">
  <div class="wrap site-header__inner">
    <a href="${home}" class="brand">
      <span class="brand__mark">A</span>
      <span class="brand__name">Agent News</span>
    </a>
    <nav class="nav" aria-label="Primary">
      <a href="${aiNewsAnchor}" class="active">AI-News</a>
      <a href="${deepDivesAnchor}">Deep Dives</a>
      <a href="${articlesAnchor}">Articles</a>
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
          <li><a href="${home}#ai-news">AI-News</a></li>
          <li><a href="${home}#deep-dives">Deep Dives</a></li>
          <li><a href="${home}#articles">Articles</a></li>
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

/** Internal: category resolver. Absent values fall back to the schema default. */
function videoCategory(entry: CatalogEntry): 'deep-dive' | 'ai-news' {
  return entry.category ?? DEFAULT_CATALOG_CATEGORY;
}

function linkCategory(entry: LinkEntry): 'article' | 'ai-news' {
  return entry.category ?? DEFAULT_LINK_CATEGORY;
}

/**
 * Render the full catalog HTML page.
 *
 * The page is composed of three independent lists, in this order:
 *
 *   1. **AI-News**   — mixed feed: catalog video entries with
 *                      `category === 'ai-news'` PLUS link entries with
 *                      `category === 'ai-news'`. Sorted newest-first by
 *                      best-available upstream date (video: YouTube upload
 *                      date, fallback site publish date; link: publishedAt).
 *   2. **Deep Dives**— catalog video entries with default category
 *                      (`deep-dive`). Sorted as above.
 *   3. **Articles**  — link entries with default category (`article`).
 *                      Sorted newest-first by publishedAt.
 *
 * Empty sections are omitted. If all three are empty, an empty-state card
 * is rendered.
 *
 * @param entries Self-hosted video catalog entries.
 * @param options Optional links (external articles) and basePath.
 */
export function renderCatalogHtml(
  entries: readonly CatalogEntry[],
  options: RenderCatalogOptions = {},
): string {
  const bp = normalizeBasePath(options.basePath ?? '');
  const links = options.links ?? [];

  // --- Videos: sort newest-first by YouTube date, fallback to site date ---
  const sortedVideos = entries.slice().sort(compareVideos);
  // --- Links: sort newest-first by publishedAt ---
  const sortedLinks = links.slice().sort(compareLinks);

  // --- Partition by category ---
  const aiNewsVideos = sortedVideos.filter((e) => videoCategory(e) === 'ai-news');
  const deepDiveVideos = sortedVideos.filter((e) => videoCategory(e) === 'deep-dive');
  const aiNewsLinks = sortedLinks.filter((e) => linkCategory(e) === 'ai-news');
  const articleLinks = sortedLinks.filter((e) => linkCategory(e) === 'article');

  const aiNewsTotal = aiNewsVideos.length + aiNewsLinks.length;
  const deepDiveTotal = deepDiveVideos.length;
  const articleTotal = articleLinks.length;

  const heroDate = pickHeroDate(sortedVideos, sortedLinks);

  // --- Body assembly ---
  let body: string;
  if (aiNewsTotal === 0 && deepDiveTotal === 0 && articleTotal === 0) {
    body = renderHero(heroDate) + renderEmptyAll();
  } else {
    body =
      renderHero(heroDate) +
      (aiNewsTotal === 0
        ? ''
        : renderAiNewsSection(aiNewsVideos, aiNewsLinks, bp)) +
      (deepDiveTotal === 0 ? '' : renderDeepDivesSection(deepDiveVideos, bp)) +
      (articleTotal === 0 ? '' : renderArticlesSection(articleLinks));
  }

  const description =
    `Agent News — three streams: AI-News, Deep Dives, and Articles. ` +
    `${aiNewsTotal} AI-News, ${deepDiveTotal} Deep Dive${deepDiveTotal === 1 ? '' : 's'}, ` +
    `${articleTotal} Article${articleTotal === 1 ? '' : 's'}.`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent News</title>
<meta name="description" content="${escapeHtml(description)}">
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

function compareVideos(a: CatalogEntry, b: CatalogEntry): number {
  const ka = sortKey(a);
  const kb = sortKey(b);
  if (ka < kb) return 1;
  if (ka > kb) return -1;
  if (a.publishedAt < b.publishedAt) return 1;
  if (a.publishedAt > b.publishedAt) return -1;
  return 0;
}

function compareLinks(a: LinkEntry, b: LinkEntry): number {
  if (a.publishedAt < b.publishedAt) return 1;
  if (a.publishedAt > b.publishedAt) return -1;
  return 0;
}

/**
 * Pick a single ISO date for the hero "Updated …" footnote: the most-recent
 * publishedAt across all videos and links. Falls back to "now" if both lists
 * are empty.
 */
function pickHeroDate(
  videos: readonly CatalogEntry[],
  links: readonly LinkEntry[],
): string {
  const candidates: string[] = [];
  for (const v of videos) candidates.push(v.publishedAt);
  for (const l of links) candidates.push(l.publishedAt);
  if (candidates.length === 0) return new Date().toISOString();
  return candidates.reduce((acc, x) => (x > acc ? x : acc), candidates[0] as string);
}

// ---------------------------------------------------------------------------
// Hero (generic site intro, no longer tied to a specific lead story)
// ---------------------------------------------------------------------------

function renderHero(latestIso: string): string {
  const date = escapeHtml(formatPublishedAt(latestIso));
  return `
<section class="hero">
  <div class="wrap">
    <div class="hero__intro">
      <h1 class="hero__title">News from the <em>agent stack.</em></h1>
      <p class="hero__lede">
        Three streams: <strong>AI-News</strong> for the broader picture, <strong>Deep Dives</strong> for technical video walkthroughs, and <strong>Articles</strong> curated from around the web.
        <small>Updated ${date}</small>
      </p>
    </div>
  </div>
</section>`.trim();
}

// ---------------------------------------------------------------------------
// Section: AI-News (mixed videos + links)
// ---------------------------------------------------------------------------

function renderAiNewsSection(
  videos: readonly CatalogEntry[],
  links: readonly LinkEntry[],
  bp: string,
): string {
  // Merge into a single newest-first stream. Each item carries enough info
  // to render either a video card or a link card.
  type Item =
    | { kind: 'video'; date: string; entry: CatalogEntry }
    | { kind: 'link'; date: string; entry: LinkEntry };

  const items: Item[] = [];
  for (const v of videos) {
    items.push({ kind: 'video', date: sortKey(v), entry: v });
  }
  for (const l of links) {
    items.push({ kind: 'link', date: l.publishedAt, entry: l });
  }
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const cards = items
    .map((it) =>
      it.kind === 'video' ? renderCard(it.entry, bp) : renderLinkCard(it.entry),
    )
    .join('\n');
  const count = items.length;
  const label = `${count} item${count === 1 ? '' : 's'}`;

  return `
<section class="section" id="ai-news">
  <div class="wrap">
    <div class="section__head">
      <h2>AI-News</h2>
      <span class="count">${escapeHtml(label)}</span>
    </div>
    <div class="grid-3">
${cards}
    </div>
  </div>
</section>`.trim();
}

// ---------------------------------------------------------------------------
// Section: Deep Dives (technical video walkthroughs)
// ---------------------------------------------------------------------------

function renderDeepDivesSection(
  videos: readonly CatalogEntry[],
  bp: string,
): string {
  const count = videos.length;
  const label = `${count} video${count === 1 ? '' : 's'}`;
  const cards = videos.map((e) => renderCard(e, bp)).join('\n');
  return `
<section class="section" id="deep-dives">
  <div class="wrap">
    <div class="section__head">
      <h2>Deep Dives</h2>
      <span class="count">${escapeHtml(label)}</span>
    </div>
    <div class="grid-3">
${cards}
    </div>
  </div>
</section>`.trim();
}

// ---------------------------------------------------------------------------
// Section: Articles (curated external links)
// ---------------------------------------------------------------------------

function renderArticlesSection(links: readonly LinkEntry[]): string {
  const count = links.length;
  const label = `${count} article${count === 1 ? '' : 's'}`;
  const cards = links.map(renderLinkCard).join('\n');
  return `
<section class="section" id="articles">
  <div class="wrap">
    <div class="section__head">
      <h2>Articles</h2>
      <span class="count">${escapeHtml(label)}</span>
    </div>
    <div class="grid-3">
${cards}
    </div>
  </div>
</section>`.trim();
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

function renderCard(entry: CatalogEntry, bp: string): string {
  const slug = escapeHtml(entry.slug);
  const title = escapeHtml(entry.title);
  const thumb = escapeHtml(entry.thumbnailUrl);
  const href = `${bp}/a/${slug}`;
  const tagLabel = videoCategory(entry) === 'ai-news' ? 'AI-News · Video' : 'Deep dive';
  return `      <article class="card">
        <a href="${href}" class="card__art" aria-label="${title}">
          <img src="${thumb}" alt="${title}" loading="lazy" decoding="async">
        </a>
        <div class="card__body">
          <div class="card__meta">
            <span class="tag">${escapeHtml(tagLabel)}</span>
          </div>
${renderDates(entry)}
          <h3 class="card__title"><a href="${href}">${title}</a></h3>
        </div>
      </article>`;
}

// ---------------------------------------------------------------------------
// External link card
// ---------------------------------------------------------------------------

function renderLinkCard(entry: LinkEntry): string {
  const title = escapeHtml(entry.title);
  const url = escapeHtml(entry.url);
  const image = escapeHtml(entry.imageUrl);
  const host = escapeHtml(entry.sourceSite);
  const date = escapeHtml(formatPublishedAt(entry.publishedAt));
  const tagLabel = linkCategory(entry) === 'ai-news' ? 'AI-News · Article' : 'Article';
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
            <span class="tag tag--link">${escapeHtml(tagLabel)}</span>
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
      <div class="empty__eyebrow">0 items published</div>
      <h2 class="empty__title">No content yet.</h2>
      <p class="empty__body">Add content to one of the three lists (AI-News, Deep Dives, Articles) with <code>npm run publish-article</code> or <code>npm run publish-link</code> — see <code>docs/PUBLISHING.md</code>.</p>
    </div>
  </div>
</section>`.trim();
}
