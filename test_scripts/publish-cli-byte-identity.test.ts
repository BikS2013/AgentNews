/**
 * publish-cli-byte-identity.test.ts
 *
 * Integration test suite for:
 *   - publish-article CLI (src/cli/publish-article.ts)
 *   - HTTP server routes (src/server.ts, src/server/routes/article.ts,
 *     src/server/routes/catalog.ts)
 *
 * PRIMARY GOAL: verify AC1 (byte-identity end-to-end) for ALL 7 sample
 * articles — sha256(GET /a/<slug> response body) === sha256(source file).
 *
 * Concurrency safety:
 *   - A unique temp dir is created per test run (UUID-based).
 *   - The server is started on port 0 (OS-assigned).
 *   - No access to data/catalog.json or articles/ at the project root.
 *
 * Run:
 *   npx tsx --test test_scripts/publish-cli-byte-identity.test.ts
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import * as path from 'node:path';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

import { CatalogStore } from '../src/catalog/store.js';
import { LinksStore } from '../src/links/store.js';
import { articleRoute } from '../src/server/routes/article.js';
import { catalogRoute } from '../src/server/routes/catalog.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SAMPLES_DIR = path.join(PROJECT_ROOT, 'samples');
const CLI_SCRIPT = path.join(PROJECT_ROOT, 'src', 'cli', 'publish-article.ts');

const HERMES_THUMBNAIL_OVERRIDE = 'https://example.com/hermes-test-thumb.jpg';

/** All 7 sample articles. */
const SAMPLES: Array<{ filename: string; needsThumbnailOverride: boolean }> = [
  {
    filename: 'Deep Dive — _handoff is my new favourite skill (Matt Pocock).html',
    needsThumbnailOverride: false,
  },
  {
    filename: 'Deep Dive — Anthropic Masterclass Agent Harnesses (Cole Medin).html',
    needsThumbnailOverride: false,
  },
  {
    filename: 'Deep Dive — Cooking with Agents in VS Code (Liam Hampton, Microsoft).html',
    needsThumbnailOverride: false,
  },
  {
    // Hermes has no <img> — requires --thumbnail-url CLI override.
    filename: 'Deep Dive — Hermes Agent Phone Number (David Ondrej).html',
    needsThumbnailOverride: true,
  },
  {
    filename:
      'Deep Dive — Opus 4.7 & OpenAI 5.5 Made Your Prompting Style Obsolete (Nate B Jones).html',
    needsThumbnailOverride: false,
  },
  {
    filename:
      'Deep Dive — Scaling Agents on Kubernetes with ACPX and ACP (Onur Solmaz, OpenClaw).html',
    needsThumbnailOverride: false,
  },
  {
    filename: 'Deep Dive — The Perfect Zsh Setup For 2026 (Dreams of Code).html',
    needsThumbnailOverride: false,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 of an arbitrary Buffer. */
function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Bootstrap a minimal catalog JSON at catalogPath. */
function initEmptyCatalog(catalogPath: string): void {
  const initial = {
    schemaVersion: 1,
    entries: [],
    updatedAt: new Date(0).toISOString(),
  };
  writeFileSync(catalogPath, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');
}

/** Bootstrap a minimal links JSON at linksPath. */
function initEmptyLinks(linksPath: string): void {
  const initial = {
    schemaVersion: 1,
    entries: [],
    updatedAt: new Date(0).toISOString(),
  };
  writeFileSync(linksPath, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');
}

/**
 * Run the publish CLI as a subprocess via `npx tsx`.
 * This avoids any stdout/stderr capture conflicts with the test runner.
 */
function runCli(
  args: string[],
  env: { articlesDir: string; catalogPath: string; linksPath: string },
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(
    'npx',
    ['tsx', CLI_SCRIPT, ...args],
    {
      env: {
        ...process.env,
        PORT: '9999', // required by loadConfig but unused by CLI
        ARTICLES_DIR: env.articlesDir,
        CATALOG_PATH: env.catalogPath,
        LINKS_PATH: env.linksPath,
      },
      encoding: 'utf8',
      timeout: 30000,
    },
  );

  const exitCode = result.status ?? 1;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  if (result.error) {
    throw new Error(`Failed to spawn CLI: ${result.error.message}`);
  }

  return { exitCode, stdout, stderr };
}

/**
 * Build a Fastify server instance programmatically, pointing at a specific
 * temp articlesDir and catalogPath. Listens on port 0 (OS assigns).
 * Returns the fastify instance; the caller must call .close() when done.
 *
 * Rationale for NOT using src/server.ts start():
 *   src/server.ts has a top-level `start().catch(...)` call that fires on
 *   import, which would attempt to bind a server and call process.exit on
 *   config errors. We construct the server inline using the same plugin and
 *   route registrations to avoid that side effect.
 */
async function buildServer(opts: {
  articlesDir: string;
  catalogPath: string;
  linksPath: string;
}): Promise<{ fastify: FastifyInstance; port: number }> {
  const store = new CatalogStore(opts.catalogPath);
  await store.load();

  const linksStore = new LinksStore(opts.linksPath);
  await linksStore.load();

  const fastify = Fastify({ logger: false });

  await fastify.register(fastifyStatic, {
    root: opts.articlesDir,
    serve: false,
    decorateReply: true,
    contentType: false,
    etag: false,
    lastModified: false,
    index: false,
    preCompressed: false,
    cacheControl: false,
  });

  await fastify.register(async (scope) => {
    await articleRoute(scope, { store, articlesDir: opts.articlesDir });
  });

  await fastify.register(async (scope) => {
    await catalogRoute(scope, { store, linksStore });
  });

  await fastify.listen({ port: 0, host: '127.0.0.1' });

  const address = fastify.server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server did not bind to a TCP address');
  }
  const { port } = address;

  return { fastify, port };
}

/** HTTP GET returning raw Buffer + status + headers. */
function httpGet(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks),
          headers: res.headers,
        });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Suite 1 — CLI smoke tests
// ---------------------------------------------------------------------------

describe('CLI smoke tests', () => {
  let tempDir: string;
  let articlesDir: string;
  let catalogPath: string;
  let linksPath: string;

  // Two samples with embedded thumbnails (no --thumbnail-url needed).
  const sampleA = path.join(
    SAMPLES_DIR,
    'Deep Dive — _handoff is my new favourite skill (Matt Pocock).html',
  );
  const sampleB = path.join(
    SAMPLES_DIR,
    'Deep Dive — The Perfect Zsh Setup For 2026 (Dreams of Code).html',
  );

  before(() => {
    tempDir = path.join(os.tmpdir(), randomUUID());
    articlesDir = path.join(tempDir, 'articles');
    catalogPath = path.join(tempDir, 'catalog.json');
    linksPath = path.join(tempDir, 'links.json');
    mkdirSync(articlesDir, { recursive: true });
    initEmptyCatalog(catalogPath);
    initEmptyLinks(linksPath);
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('publishes first article — exit 0, valid JSON on stdout, disk SHA matches source SHA', () => {
    const { exitCode, stdout, stderr } = runCli(
      ['--source', sampleA],
      { articlesDir, catalogPath, linksPath },
    );

    assert.equal(exitCode, 0, `Expected exit 0, got ${exitCode}. stderr: ${stderr}`);

    // stdout must be a single JSON line.
    const entry = JSON.parse(stdout.trim()) as Record<string, unknown>;

    // All required fields present.
    assert.ok(typeof entry['slug'] === 'string' && (entry['slug'] as string).length > 0, 'slug must be non-empty string');
    assert.ok(typeof entry['title'] === 'string' && (entry['title'] as string).length > 0, 'title must be non-empty string');
    assert.ok(typeof entry['sha256'] === 'string', 'sha256 must be a string');
    assert.match(
      entry['sha256'] as string,
      /^[a-f0-9]{64}$/,
      'sha256 must be 64 lower-case hex chars',
    );

    // Disk SHA must match source SHA.
    const sourceBuffer = readFileSync(sampleA);
    const sourceSha = sha256Hex(sourceBuffer);
    assert.equal(
      entry['sha256'],
      sourceSha,
      'Catalog sha256 must match source file sha256',
    );

    const slug = entry['slug'] as string;
    const writtenPath = path.join(articlesDir, `${slug}.html`);
    assert.ok(existsSync(writtenPath), `Article file must exist at ${writtenPath}`);

    const diskBuffer = readFileSync(writtenPath);
    const diskSha = sha256Hex(diskBuffer);
    assert.equal(diskSha, sourceSha, 'Written disk file SHA-256 must match source SHA-256');
  });

  it('publishes second article — exit 0, catalog now has two entries', () => {
    const { exitCode, stdout, stderr } = runCli(
      ['--source', sampleB],
      { articlesDir, catalogPath, linksPath },
    );

    assert.equal(exitCode, 0, `Expected exit 0, got ${exitCode}. stderr: ${stderr}`);

    const entry = JSON.parse(stdout.trim()) as Record<string, unknown>;
    const sourceBuffer = readFileSync(sampleB);
    const sourceSha = sha256Hex(sourceBuffer);
    assert.equal(entry['sha256'], sourceSha, 'Second article sha256 must match source');

    // Read catalog file directly to verify entry count.
    const catalogRaw = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      entries: unknown[];
    };
    assert.equal(catalogRaw.entries.length, 2, 'Catalog must have 2 entries after second publish');
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — CLI no-thumbnail policy (Hermes article)
// ---------------------------------------------------------------------------

describe('CLI no-thumbnail policy — Hermes article', () => {
  let tempDir: string;
  let articlesDir: string;
  let catalogPath: string;
  let linksPath: string;

  const hermesSample = path.join(
    SAMPLES_DIR,
    'Deep Dive — Hermes Agent Phone Number (David Ondrej).html',
  );

  before(() => {
    tempDir = path.join(os.tmpdir(), randomUUID());
    articlesDir = path.join(tempDir, 'articles');
    catalogPath = path.join(tempDir, 'catalog.json');
    linksPath = path.join(tempDir, 'links.json');
    mkdirSync(articlesDir, { recursive: true });
    initEmptyCatalog(catalogPath);
    initEmptyLinks(linksPath);
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('exits 1 with NO_THUMBNAIL when Hermes article published without --thumbnail-url', () => {
    const { exitCode, stderr } = runCli(
      ['--source', hermesSample],
      { articlesDir, catalogPath, linksPath },
    );

    assert.equal(exitCode, 1, `Expected exit 1, got ${exitCode}`);
    assert.ok(
      stderr.includes('NO_THUMBNAIL'),
      `stderr must contain "NO_THUMBNAIL". Got: ${stderr}`,
    );
  });

  it('exits 0 with thumbnailSource=cli-override when --thumbnail-url is supplied', () => {
    const { exitCode, stdout, stderr } = runCli(
      ['--source', hermesSample, '--thumbnail-url', HERMES_THUMBNAIL_OVERRIDE],
      { articlesDir, catalogPath, linksPath },
    );

    assert.equal(exitCode, 0, `Expected exit 0, got ${exitCode}. stderr: ${stderr}`);

    const entry = JSON.parse(stdout.trim()) as Record<string, unknown>;
    assert.equal(
      entry['thumbnailSource'],
      'cli-override',
      'thumbnailSource must be "cli-override" when --thumbnail-url flag is used',
    );
    assert.equal(
      entry['thumbnailUrl'],
      HERMES_THUMBNAIL_OVERRIDE,
      'thumbnailUrl must equal the CLI-supplied override value',
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — CLI conflict detection
// ---------------------------------------------------------------------------

describe('CLI conflict detection', () => {
  let tempDir: string;
  let articlesDir: string;
  let catalogPath: string;
  let linksPath: string;
  let originalPublishedAt: string;
  let originalSlug: string;

  const sampleA = path.join(
    SAMPLES_DIR,
    'Deep Dive — _handoff is my new favourite skill (Matt Pocock).html',
  );

  before(async () => {
    tempDir = path.join(os.tmpdir(), randomUUID());
    articlesDir = path.join(tempDir, 'articles');
    catalogPath = path.join(tempDir, 'catalog.json');
    linksPath = path.join(tempDir, 'links.json');
    mkdirSync(articlesDir, { recursive: true });
    initEmptyCatalog(catalogPath);
    initEmptyLinks(linksPath);

    // First publish must succeed.
    const { exitCode, stdout, stderr } = runCli(
      ['--source', sampleA],
      { articlesDir, catalogPath, linksPath },
    );
    assert.equal(exitCode, 0, `Initial publish in before() must succeed. stderr: ${stderr}`);

    const entry = JSON.parse(stdout.trim()) as { slug: string; publishedAt: string };
    originalPublishedAt = entry.publishedAt;
    originalSlug = entry.slug;
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('exits 3 with ALREADY_PUBLISHED when same article is published again without --update', () => {
    const { exitCode, stderr } = runCli(
      ['--source', sampleA],
      { articlesDir, catalogPath, linksPath },
    );

    assert.equal(exitCode, 3, `Expected exit 3, got ${exitCode}`);
    assert.ok(
      stderr.includes('ALREADY_PUBLISHED'),
      `stderr must contain "ALREADY_PUBLISHED". Got: ${stderr}`,
    );
  });

  it('exits 0 and preserves publishedAt and slug when --update is supplied', () => {
    const { exitCode, stdout, stderr } = runCli(
      ['--source', sampleA, '--update'],
      { articlesDir, catalogPath, linksPath },
    );

    assert.equal(exitCode, 0, `Expected exit 0, got ${exitCode}. stderr: ${stderr}`);

    const entry = JSON.parse(stdout.trim()) as Record<string, unknown>;
    assert.equal(
      entry['publishedAt'],
      originalPublishedAt,
      'publishedAt must be preserved on --update (immutable field)',
    );
    assert.equal(
      entry['slug'],
      originalSlug,
      'slug must be preserved on --update (immutable field)',
    );

    // Catalog still has exactly 1 entry (no duplicate created).
    const catalogRaw = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      entries: unknown[];
    };
    assert.equal(
      catalogRaw.entries.length,
      1,
      'Catalog must still have 1 entry after --update (no duplicate)',
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — HTTP byte-identity for all 7 articles (AC1)
// ---------------------------------------------------------------------------

describe('HTTP byte-identity — all 7 articles (AC1)', () => {
  let tempDir: string;
  let articlesDir: string;
  let catalogPath: string;
  let linksPath: string;
  let fastify: FastifyInstance;
  let port: number;

  /**
   * Map from sample filename → { slug, sha256, sourcePath }.
   * Populated in before() after CLI publish of all 7 samples.
   */
  const publishedEntries = new Map<
    string,
    { slug: string; sha256: string; sourcePath: string; title: string }
  >();

  before(async () => {
    tempDir = path.join(os.tmpdir(), randomUUID());
    articlesDir = path.join(tempDir, 'articles');
    catalogPath = path.join(tempDir, 'catalog.json');
    linksPath = path.join(tempDir, 'links.json');
    mkdirSync(articlesDir, { recursive: true });
    initEmptyCatalog(catalogPath);
    initEmptyLinks(linksPath);

    // Publish all 7 samples via CLI subprocess.
    for (const sample of SAMPLES) {
      const sourcePath = path.join(SAMPLES_DIR, sample.filename);
      const cliArgs = ['--source', sourcePath];
      if (sample.needsThumbnailOverride) {
        cliArgs.push('--thumbnail-url', HERMES_THUMBNAIL_OVERRIDE);
      }

      const { exitCode, stdout, stderr } = runCli(cliArgs, {
        articlesDir,
        catalogPath,
        linksPath,
      });

      assert.equal(
        exitCode,
        0,
        `Expected exit 0 publishing "${sample.filename}". stderr: ${stderr}`,
      );

      const entry = JSON.parse(stdout.trim()) as {
        slug: string;
        sha256: string;
        title: string;
        sourcePath: string;
      };

      publishedEntries.set(sample.filename, {
        slug: entry.slug,
        sha256: entry.sha256,
        sourcePath,
        title: entry.title,
      });
    }

    // Boot server pointing at temp dir.
    ({ fastify, port } = await buildServer({ articlesDir, catalogPath, linksPath }));
  });

  after(async () => {
    await fastify.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // --- verification that setup succeeded ---

  it('all 7 samples are published into the temp catalog', () => {
    assert.equal(
      publishedEntries.size,
      7,
      `Expected 7 catalog entries; got ${publishedEntries.size}`,
    );
  });

  // --- per-article byte-identity tests ---

  for (const sample of SAMPLES) {
    const label = sample.filename.replace(/\.html$/, '');

    it(`byte-identity: GET /a/<slug> === source file — "${label}"`, async () => {
      const info = publishedEntries.get(sample.filename);
      assert.ok(
        info !== undefined,
        `No published entry found for "${sample.filename}" — did the before() hook fail?`,
      );

      const url = `http://127.0.0.1:${port}/a/${info.slug}`;

      // GET with Accept-Encoding: identity to suppress any content negotiation.
      const { status, body, headers } = await httpGet(url, {
        'Accept-Encoding': 'identity',
      });

      // 1. Status must be 200.
      assert.equal(status, 200, `Expected HTTP 200 for ${url}, got ${status}`);

      // 2. Content-Type must be exactly text/html; charset=utf-8.
      assert.equal(
        headers['content-type'],
        'text/html; charset=utf-8',
        `Content-Type mismatch for ${url}. Got: "${headers['content-type']}"`,
      );

      // 3. Content-Encoding must be absent or "identity" — no compression.
      const ce = headers['content-encoding'];
      assert.ok(
        ce === undefined || ce === 'identity',
        `Content-Encoding must be absent or "identity"; got "${ce}" for ${url}`,
      );

      // 4. AC1: SHA-256 of raw response Buffer must equal catalog sha256.
      const responseSha = sha256Hex(body);
      assert.equal(
        responseSha,
        info.sha256,
        `AC1 FAILED — byte-identity broken for "${sample.filename}":\n` +
          `  response sha256 = ${responseSha}\n` +
          `  catalog sha256  = ${info.sha256}`,
      );

      // 5. AC1 (double-check): response SHA must also equal source file SHA.
      const sourceBuffer = readFileSync(info.sourcePath);
      const sourceSha = sha256Hex(sourceBuffer);
      assert.equal(
        responseSha,
        sourceSha,
        `AC1 FAILED — response not byte-identical to source for "${sample.filename}":\n` +
          `  response sha256 = ${responseSha}\n` +
          `  source sha256   = ${sourceSha}`,
      );
    });
  }

  // --- negative path tests ---

  it('GET /a/does-not-exist returns 404', async () => {
    const url = `http://127.0.0.1:${port}/a/does-not-exist`;
    const { status } = await httpGet(url, { 'Accept-Encoding': 'identity' });
    assert.equal(status, 404, `Expected 404 for ${url}, got ${status}`);
  });

  it('GET /a/INVALID..SLUG returns 404 (slug regex rejects uppercase and dots)', async () => {
    // SLUG_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/ — uppercase and dots fail.
    const url = `http://127.0.0.1:${port}/a/INVALID..SLUG`;
    const { status } = await httpGet(url);
    assert.equal(status, 404, `Expected 404 for invalid slug, got ${status}`);
  });

  // --- catalog index page ---

  it('GET / returns 200, Content-Type text/html, and page contains <title>Agent News</title>', async () => {
    const url = `http://127.0.0.1:${port}/`;
    const { status, body, headers } = await httpGet(url);

    assert.equal(status, 200, `Expected 200 from catalog root, got ${status}`);
    assert.match(
      headers['content-type'] ?? '',
      /text\/html/,
      'Content-Type must contain text/html for catalog page',
    );

    const html = body.toString('utf8');
    assert.ok(
      html.includes('<title>Agent News</title>'),
      'Catalog page must contain <title>Agent News</title>',
    );
  });

  it('GET / catalog page contains links to all 7 published articles', async () => {
    const url = `http://127.0.0.1:${port}/`;
    const { body } = await httpGet(url);
    const html = body.toString('utf8');

    for (const [filename, info] of publishedEntries.entries()) {
      assert.ok(
        html.includes(`/a/${info.slug}`),
        `Catalog HTML must contain a link to /a/${info.slug} (from "${filename}")`,
      );
    }
  });
});
