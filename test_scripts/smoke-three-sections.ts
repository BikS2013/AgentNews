#!/usr/bin/env tsx
/**
 * Smoke test: renderCatalogHtml emits three sections (AI-News → Deep Dives →
 * Articles) when each is populated, and skips empty sections.
 *
 * Run: npx tsx test_scripts/smoke-three-sections.ts
 */
import { renderCatalogHtml } from '../src/server/render/catalog.js';
import type { CatalogEntry } from '../src/catalog/types.js';
import type { LinkEntry } from '../src/links/types.js';

const deepDiveVideo: CatalogEntry = {
  slug: 'deep-dive-sample',
  title: 'Deep Dive — Sample Video',
  publishedAt: '2025-11-12T09:00:00.000Z',
  sourcePath: 'samples/deep-dive-sample.html',
  articlePath: 'articles/deep-dive-sample.html',
  thumbnailUrl: 'https://img.youtube.com/vi/abc123/maxresdefault.jpg',
  thumbnailSource: 'html',
  sha256: 'a'.repeat(64),
  youtubePublishedAt: '2025-11-11T08:00:00.000Z',
};

const aiNewsVideo: CatalogEntry = {
  slug: 'ai-news-roundup',
  title: 'This Week in AI — Roundup',
  publishedAt: '2025-11-12T10:00:00.000Z',
  sourcePath: 'samples/ai-news-roundup.html',
  articlePath: 'articles/ai-news-roundup.html',
  thumbnailUrl: 'https://img.youtube.com/vi/xyz789/maxresdefault.jpg',
  thumbnailSource: 'html',
  sha256: 'b'.repeat(64),
  category: 'ai-news',
};

const articleLink: LinkEntry = {
  id: 'building-a-multi-agent-pipeline',
  title: 'Building a Multi-Agent Pipeline',
  url: 'https://example.com/multi-agent-pipeline',
  imageUrl: 'https://example.com/cover.jpg',
  sourceSite: 'example.com',
  publishedAt: '2025-11-10T09:00:00.000Z',
};

const aiNewsLink: LinkEntry = {
  id: 'openai-launches-something',
  title: 'OpenAI launches something',
  url: 'https://nytimes.com/openai-launches-something',
  imageUrl: 'https://nytimes.com/cover.jpg',
  sourceSite: 'nytimes.com',
  publishedAt: '2025-11-12T11:00:00.000Z',
  category: 'ai-news',
};

const html = renderCatalogHtml([deepDiveVideo, aiNewsVideo], {
  links: [articleLink, aiNewsLink],
  basePath: '',
});

// Assertions
const expectations: Array<[string, RegExp | string]> = [
  ['AI-News section anchor', 'id="ai-news"'],
  ['Deep Dives section anchor', 'id="deep-dives"'],
  ['Articles section anchor', 'id="articles"'],
  ['AI-News heading', /<h2>AI-News<\/h2>/],
  ['Deep Dives heading', /<h2>Deep Dives<\/h2>/],
  ['Articles heading', /<h2>Articles<\/h2>/],
  ['AI-News video appears in AI-News', /This Week in AI — Roundup/],
  ['AI-News link appears in AI-News', /OpenAI launches something/],
  ['Deep dive video appears', /Deep Dive — Sample Video/],
  ['Article link appears', /Building a Multi-Agent Pipeline/],
  ['AI-News video tag is present', /AI-News · Video/],
  ['AI-News article tag is present', /AI-News · Article/],
];

let failed = 0;
for (const [name, expected] of expectations) {
  const ok =
    typeof expected === 'string'
      ? html.includes(expected)
      : expected.test(html);
  if (ok) {
    process.stdout.write(`  OK  ${name}\n`);
  } else {
    process.stdout.write(`  FAIL ${name}\n`);
    failed += 1;
  }
}

// Section ordering check
const aiNewsIdx = html.indexOf('id="ai-news"');
const deepDivesIdx = html.indexOf('id="deep-dives"');
const articlesIdx = html.indexOf('id="articles"');
if (aiNewsIdx !== -1 && deepDivesIdx !== -1 && articlesIdx !== -1 &&
    aiNewsIdx < deepDivesIdx && deepDivesIdx < articlesIdx) {
  process.stdout.write(`  OK  Section order: AI-News → Deep Dives → Articles\n`);
} else {
  process.stdout.write(
    `  FAIL Section order incorrect (ai-news=${aiNewsIdx}, deep-dives=${deepDivesIdx}, articles=${articlesIdx})\n`,
  );
  failed += 1;
}

// Boundary: a deep-dive video must not appear inside the AI-News section
const aiNewsSection = html.slice(aiNewsIdx, deepDivesIdx);
if (!aiNewsSection.includes('Deep Dive — Sample Video')) {
  process.stdout.write(`  OK  Deep-dive video does not leak into AI-News section\n`);
} else {
  process.stdout.write(`  FAIL Deep-dive video leaked into AI-News section\n`);
  failed += 1;
}

// Boundary: an article (link) must not appear inside the AI-News section
// when its category is 'article'
if (!aiNewsSection.includes('Building a Multi-Agent Pipeline')) {
  process.stdout.write(`  OK  Article link does not leak into AI-News section\n`);
} else {
  process.stdout.write(`  FAIL Article link leaked into AI-News section\n`);
  failed += 1;
}

if (failed > 0) {
  process.stderr.write(`\nFAILED: ${failed} assertion(s)\n`);
  process.exit(1);
}
process.stdout.write(`\nALL ASSERTIONS PASSED\n`);
