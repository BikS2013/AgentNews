/**
 * experimental-build.test.ts
 *
 * Regression test suite for the experimental sibling-publish pipeline.
 *
 * Covers:
 *   1. publish-experimental-article CLI guard rejects EXPERIMENTAL_DIR whose
 *      basename is not exactly "experimental" (single-writer enforcement).
 *   2. publish-experimental-article CLI guard rejects
 *      EXPERIMENTAL_CATALOG_PATH whose basename does not start with
 *      "experimental-" (single-writer enforcement).
 *   3. publish-experimental-article CLI publishes a byte-identical article
 *      into a temp experimental tree.
 *   4. build-experimental script emits each manifest entry byte-identically
 *      into <OUT_DIR>/a/<slug>.html.
 *   5. build-experimental script refuses to run when its inputs do not look
 *      experimental (symmetric guard).
 *   6. build-static (PUBLIC build) is unaffected by the presence of
 *      experimental content — zero-leakage guarantee. The public dist is
 *      byte-identical with and without experimental content alongside.
 *
 * Concurrency safety:
 *   - Every suite uses a fresh UUID-based temp dir under os.tmpdir().
 *   - No suite touches the project-root articles/, data/catalog.json, or
 *     data/experimental-catalog.json.
 *
 * Run:
 *   npx tsx --test test_scripts/experimental-build.test.ts
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import * as path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SAMPLES_DIR = path.join(PROJECT_ROOT, 'samples');
const CLI_SCRIPT = path.join(
  PROJECT_ROOT,
  'src',
  'cli',
  'publish-experimental-article.ts',
);
const BUILD_EXPERIMENTAL_SCRIPT = path.join(
  PROJECT_ROOT,
  'scripts',
  'build-experimental.ts',
);
const BUILD_STATIC_SCRIPT = path.join(
  PROJECT_ROOT,
  'scripts',
  'build-static.ts',
);

const SAMPLE_WITH_IMG = path.join(
  SAMPLES_DIR,
  'Deep Dive — _handoff is my new favourite skill (Matt Pocock).html',
);
const SAMPLE_WITH_IMG_2 = path.join(
  SAMPLES_DIR,
  'Deep Dive — The Perfect Zsh Setup For 2026 (Dreams of Code).html',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function initEmptyCatalog(manifestPath: string): void {
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      { schemaVersion: 1, entries: [], updatedAt: new Date(0).toISOString() },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function initEmptyLinks(linksPath: string): void {
  writeFileSync(
    linksPath,
    `${JSON.stringify(
      { schemaVersion: 1, entries: [], updatedAt: new Date(0).toISOString() },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function runExperimentalCli(
  args: string[],
  env: {
    experimentalDir: string;
    experimentalCatalogPath: string;
  },
): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync('npx', ['tsx', CLI_SCRIPT, ...args], {
    env: {
      ...process.env,
      EXPERIMENTAL_DIR: env.experimentalDir,
      EXPERIMENTAL_CATALOG_PATH: env.experimentalCatalogPath,
      // Defensive: ensure the public-flow vars are NOT inherited from the
      // test harness shell — that way an accidental fallback to loadConfig()
      // would surface as a missing-env error, not a silent path mix-up.
      PORT: '',
      ARTICLES_DIR: '',
      CATALOG_PATH: '',
      LINKS_PATH: '',
    },
    encoding: 'utf8',
    timeout: 30000,
  });
  if (result.error) {
    throw new Error(`Failed to spawn experimental CLI: ${result.error.message}`);
  }
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function runExperimentalBuild(env: {
  experimentalDir: string;
  experimentalCatalogPath: string;
  experimentalLinksPath: string;
  outDir: string;
  basePath: string;
}): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(
    'npx',
    ['tsx', BUILD_EXPERIMENTAL_SCRIPT],
    {
      env: {
        ...process.env,
        EXPERIMENTAL_DIR: env.experimentalDir,
        EXPERIMENTAL_CATALOG_PATH: env.experimentalCatalogPath,
        EXPERIMENTAL_LINKS_PATH: env.experimentalLinksPath,
        OUT_DIR: env.outDir,
        BASE_PATH: env.basePath,
      },
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  if (result.error) {
    throw new Error(`Failed to spawn build-experimental: ${result.error.message}`);
  }
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function runPublicBuild(env: {
  articlesDir: string;
  catalogPath: string;
  linksPath: string;
  outDir: string;
  basePath: string;
}): { exitCode: number; stdout: string; stderr: string } {
  const result = spawnSync(
    'npx',
    ['tsx', BUILD_STATIC_SCRIPT],
    {
      env: {
        ...process.env,
        ARTICLES_DIR: env.articlesDir,
        CATALOG_PATH: env.catalogPath,
        LINKS_PATH: env.linksPath,
        OUT_DIR: env.outDir,
        BASE_PATH: env.basePath,
      },
      encoding: 'utf8',
      timeout: 30000,
    },
  );
  if (result.error) {
    throw new Error(`Failed to spawn build-static: ${result.error.message}`);
  }
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/** Hash every file under `root` (deterministic recursive walk). */
function hashTree(root: string): string {
  if (!existsSync(root)) {
    return 'NONEXISTENT';
  }
  const aggregate = createHash('sha256');
  const stack: string[] = [root];
  const entries: Array<{ rel: string; sha: string }> = [];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    const items = readdirSync(dir).sort();
    for (const item of items) {
      const full = path.join(dir, item);
      const s = statSync(full);
      if (s.isDirectory()) {
        stack.push(full);
      } else {
        entries.push({
          rel: path.relative(root, full),
          sha: sha256Hex(readFileSync(full)),
        });
      }
    }
  }
  // Sort by relative path so the aggregate hash is path-order-independent
  // across filesystems.
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  for (const e of entries) {
    aggregate.update(`${e.rel}\0${e.sha}\n`);
  }
  return aggregate.digest('hex');
}

// ---------------------------------------------------------------------------
// Suite 1 — CLI single-writer guards
// ---------------------------------------------------------------------------

describe('experimental CLI — single-writer guards', () => {
  let tempDir: string;

  before(() => {
    tempDir = path.join(os.tmpdir(), randomUUID());
    mkdirSync(tempDir, { recursive: true });
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rejects EXPERIMENTAL_DIR whose basename is not "experimental"', () => {
    const badDir = path.join(tempDir, 'articles'); // basename "articles" — NOT experimental
    const catalogPath = path.join(tempDir, 'experimental-catalog.json');
    mkdirSync(badDir, { recursive: true });
    initEmptyCatalog(catalogPath);

    const { exitCode, stderr } = runExperimentalCli(
      ['--source', SAMPLE_WITH_IMG],
      { experimentalDir: badDir, experimentalCatalogPath: catalogPath },
    );

    assert.equal(exitCode, 1, `Expected exit 1, got ${exitCode}. stderr: ${stderr}`);
    assert.ok(
      stderr.includes('EXPERIMENTAL_DIR must resolve to a directory whose basename is exactly "experimental"'),
      `stderr must explain the basename rejection. Got: ${stderr}`,
    );
    // No file should have been written into the rejected dir.
    assert.equal(
      readdirSync(badDir).length,
      0,
      'CLI must not write anything when the guard rejects the path',
    );
  });

  it('rejects EXPERIMENTAL_CATALOG_PATH whose basename does not start with "experimental-"', () => {
    const dir = path.join(tempDir, 'experimental');
    const badCatalog = path.join(tempDir, 'catalog.json'); // basename "catalog.json" — public flow name
    mkdirSync(dir, { recursive: true });
    initEmptyCatalog(badCatalog);

    const { exitCode, stderr } = runExperimentalCli(
      ['--source', SAMPLE_WITH_IMG],
      { experimentalDir: dir, experimentalCatalogPath: badCatalog },
    );

    assert.equal(exitCode, 1, `Expected exit 1, got ${exitCode}. stderr: ${stderr}`);
    assert.ok(
      stderr.includes('EXPERIMENTAL_CATALOG_PATH must resolve to a file whose basename starts with "experimental-"'),
      `stderr must explain the manifest basename rejection. Got: ${stderr}`,
    );
    // No file should have been written into the experimental dir.
    assert.equal(
      readdirSync(dir).length,
      0,
      'CLI must not write anything when the manifest guard rejects the path',
    );
  });

  it('fails fast when EXPERIMENTAL_DIR env var is missing', () => {
    const result = spawnSync('npx', ['tsx', CLI_SCRIPT, '--source', SAMPLE_WITH_IMG], {
      env: {
        ...process.env,
        // Deliberately omit EXPERIMENTAL_DIR.
        EXPERIMENTAL_CATALOG_PATH: path.join(tempDir, 'experimental-catalog.json'),
        EXPERIMENTAL_DIR: '',
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    // The CLI may exit 1 (UsageError wrapped) or surface an UNEXPECTED_ERROR.
    // Either way the exit code is non-zero and the message names the var.
    assert.notEqual(result.status, 0, 'Missing EXPERIMENTAL_DIR must not exit 0');
    const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    assert.ok(
      combined.includes('EXPERIMENTAL_DIR'),
      `Error output must mention EXPERIMENTAL_DIR. Got: ${combined}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — End-to-end publish + build byte-identity
// ---------------------------------------------------------------------------

describe('experimental publish + build — byte-identity end-to-end', () => {
  let tempDir: string;
  let experimentalDir: string;
  let catalogPath: string;
  let linksPath: string;
  let outDir: string;

  before(() => {
    tempDir = path.join(os.tmpdir(), randomUUID());
    experimentalDir = path.join(tempDir, 'experimental');
    catalogPath = path.join(tempDir, 'experimental-catalog.json');
    linksPath = path.join(tempDir, 'experimental-links.json');
    outDir = path.join(tempDir, 'dist-experimental');
    mkdirSync(experimentalDir, { recursive: true });
    initEmptyCatalog(catalogPath);
    initEmptyLinks(linksPath);
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('publishes a byte-identical article into the experimental tree', () => {
    const { exitCode, stdout, stderr } = runExperimentalCli(
      ['--source', SAMPLE_WITH_IMG],
      { experimentalDir, experimentalCatalogPath: catalogPath },
    );

    assert.equal(exitCode, 0, `Expected exit 0, got ${exitCode}. stderr: ${stderr}`);

    const entry = JSON.parse(stdout.trim()) as {
      slug: string;
      sha256: string;
      articlePath: string;
    };

    // articlePath in the manifest must use the `experimental/` prefix.
    assert.ok(
      entry.articlePath.startsWith('experimental/'),
      `articlePath must start with "experimental/", got "${entry.articlePath}"`,
    );

    // Source SHA-256 must match the manifest SHA-256.
    const sourceBuffer = readFileSync(SAMPLE_WITH_IMG);
    const sourceSha = sha256Hex(sourceBuffer);
    assert.equal(entry.sha256, sourceSha, 'Manifest sha256 must match source sha256');

    // The disk file in the experimental dir must equal the source byte-for-byte.
    const writtenPath = path.join(experimentalDir, `${entry.slug}.html`);
    assert.ok(existsSync(writtenPath), `Article file must exist at ${writtenPath}`);
    const diskBuffer = readFileSync(writtenPath);
    assert.equal(sha256Hex(diskBuffer), sourceSha, 'Disk file SHA-256 must match source');
    assert.ok(diskBuffer.equals(sourceBuffer), 'Disk file bytes must equal source bytes');
  });

  it('build-experimental emits the article byte-identically into <OUT_DIR>/a/<slug>.html', () => {
    const { exitCode, stderr } = runExperimentalBuild({
      experimentalDir,
      experimentalCatalogPath: catalogPath,
      experimentalLinksPath: linksPath,
      outDir,
      basePath: '/test-target',
    });
    assert.equal(exitCode, 0, `Expected exit 0, got ${exitCode}. stderr: ${stderr}`);

    // Brand check: the experimental catalog page must say "Agent Content",
    // not "Agent News".
    const indexHtml = readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.ok(
      indexHtml.includes('<title>Agent Content</title>'),
      'experimental index.html must use <title>Agent Content</title>',
    );
    assert.ok(
      indexHtml.includes('>Agent Content<'),
      'experimental index.html must contain the "Agent Content" brand name in the body',
    );
    assert.equal(
      indexHtml.includes('Agent News'),
      false,
      'experimental index.html must NOT contain "Agent News" anywhere',
    );
    // The 404 page mirrors the brand.
    const notFoundHtml = readFileSync(path.join(outDir, '404.html'), 'utf8');
    assert.ok(
      notFoundHtml.includes('Agent Content'),
      'experimental 404.html must reference "Agent Content"',
    );

    // Hero text: experimental site uses the experiments-focused H1 and
    // four-stream lede that mentions Tools.
    assert.ok(
      indexHtml.includes('news from') && indexHtml.includes('agent experiments.'),
      'experimental index.html must render the "news from agent experiments." hero title',
    );
    assert.equal(
      indexHtml.includes('News from the'),
      false,
      'experimental index.html must NOT contain the public hero title "News from the …"',
    );
    assert.ok(
      indexHtml.includes('Four streams:'),
      'experimental lede must announce "Four streams:"',
    );
    assert.ok(
      indexHtml.includes('<strong>Tools</strong>'),
      'experimental lede must call out Tools in <strong>',
    );

    // Read manifest to find the slug.
    const manifest = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      entries: Array<{ slug: string; sha256: string }>;
    };
    assert.equal(manifest.entries.length, 1, 'Manifest must contain exactly one entry');
    const entry = manifest.entries[0]!;

    const emitted = path.join(outDir, 'a', `${entry.slug}.html`);
    assert.ok(existsSync(emitted), `Emitted file must exist at ${emitted}`);

    const emittedBuf = readFileSync(emitted);
    assert.equal(sha256Hex(emittedBuf), entry.sha256, 'Emitted file SHA-256 must match manifest');

    const sourceBuf = readFileSync(SAMPLE_WITH_IMG);
    assert.ok(
      emittedBuf.equals(sourceBuf),
      'Emitted file bytes must equal the original source file bytes',
    );

    // The build also produces an index.html and .nojekyll marker.
    assert.ok(existsSync(path.join(outDir, 'index.html')), 'Build must emit index.html');
    assert.ok(existsSync(path.join(outDir, '.nojekyll')), 'Build must emit .nojekyll');
    assert.ok(existsSync(path.join(outDir, '404.html')), 'Build must emit 404.html');
  });
});

// ---------------------------------------------------------------------------
// Suite 2b — Tools category (experimental-only)
// ---------------------------------------------------------------------------

describe('experimental Tools category', () => {
  let tempDir: string;
  let experimentalDir: string;
  let catalogPath: string;
  let linksPath: string;
  let outDir: string;

  before(() => {
    tempDir = path.join(os.tmpdir(), randomUUID());
    experimentalDir = path.join(tempDir, 'experimental');
    catalogPath = path.join(tempDir, 'experimental-catalog.json');
    linksPath = path.join(tempDir, 'experimental-links.json');
    outDir = path.join(tempDir, 'dist-experimental');
    mkdirSync(experimentalDir, { recursive: true });
    initEmptyCatalog(catalogPath);
    initEmptyLinks(linksPath);
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('publish-experimental-article accepts --category tools', () => {
    const { exitCode, stdout, stderr } = runExperimentalCli(
      ['--source', SAMPLE_WITH_IMG, '--category', 'tools'],
      { experimentalDir, experimentalCatalogPath: catalogPath },
    );
    assert.equal(exitCode, 0, `Expected exit 0, got ${exitCode}. stderr: ${stderr}`);
    const entry = JSON.parse(stdout.trim()) as { category: string };
    assert.equal(entry.category, 'tools', 'Persisted entry must have category="tools"');
  });

  it('publish-experimental-article rejects an unknown category', () => {
    const { exitCode, stderr } = runExperimentalCli(
      ['--source', SAMPLE_WITH_IMG_2, '--category', 'bogus'],
      { experimentalDir, experimentalCatalogPath: catalogPath },
    );
    assert.notEqual(exitCode, 0, `Unknown category must exit non-zero`);
    assert.ok(
      stderr.includes('Invalid --category'),
      `stderr must explain the rejection. Got: ${stderr}`,
    );
  });

  it('build-experimental renders a Tools section when entries with category=tools exist', () => {
    // Manifest already contains one tools entry from the first test in this
    // suite. Build and inspect index.html.
    const { exitCode, stderr } = runExperimentalBuild({
      experimentalDir,
      experimentalCatalogPath: catalogPath,
      experimentalLinksPath: linksPath,
      outDir,
      basePath: '/test',
    });
    assert.equal(exitCode, 0, `Build failed: ${stderr}`);

    const indexHtml = readFileSync(path.join(outDir, 'index.html'), 'utf8');
    assert.ok(
      indexHtml.includes('id="tools"'),
      'experimental index.html must contain a section with id="tools" when a tools entry exists',
    );
    assert.ok(
      indexHtml.includes('<h2>Tools</h2>'),
      'experimental index.html must contain the "Tools" section heading',
    );
    // Tools must appear AFTER Deep Dives and BEFORE Articles in the document.
    const idxDeepDives = indexHtml.indexOf('id="deep-dives"');
    const idxTools = indexHtml.indexOf('id="tools"');
    const idxArticles = indexHtml.indexOf('id="articles"');
    if (idxDeepDives !== -1) {
      assert.ok(idxTools > idxDeepDives, 'Tools section must come AFTER Deep Dives');
    }
    if (idxArticles !== -1) {
      assert.ok(idxTools < idxArticles, 'Tools section must come BEFORE Articles');
    }
  });
});

// ---------------------------------------------------------------------------
// Suite 2c — Public flow still rejects 'tools' (regression guard)
// ---------------------------------------------------------------------------

describe('public publish-article — still rejects experimental-only categories', () => {
  let tempDir: string;
  let articlesDir: string;
  let catalogPath: string;
  let linksPath: string;
  const PUBLIC_CLI = path.join(PROJECT_ROOT, 'src', 'cli', 'publish-article.ts');

  before(() => {
    tempDir = path.join(os.tmpdir(), randomUUID());
    articlesDir = path.join(tempDir, 'articles');
    catalogPath = path.join(tempDir, 'catalog.json');
    linksPath = path.join(tempDir, 'links.json');
    mkdirSync(articlesDir, { recursive: true });
    writeFileSync(
      catalogPath,
      `${JSON.stringify(
        { schemaVersion: 1, entries: [], updatedAt: new Date(0).toISOString() },
        null,
        2,
      )}\n`,
      'utf8',
    );
    writeFileSync(
      linksPath,
      `${JSON.stringify(
        { schemaVersion: 1, entries: [], updatedAt: new Date(0).toISOString() },
        null,
        2,
      )}\n`,
      'utf8',
    );
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('public publish-article rejects --category tools', () => {
    const result = spawnSync(
      'npx',
      ['tsx', PUBLIC_CLI, '--source', SAMPLE_WITH_IMG, '--category', 'tools'],
      {
        env: {
          ...process.env,
          PORT: '9999',
          ARTICLES_DIR: articlesDir,
          CATALOG_PATH: catalogPath,
          LINKS_PATH: linksPath,
        },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    assert.notEqual(result.status, 0, 'Public CLI must reject --category tools');
    const stderr = result.stderr ?? '';
    assert.ok(
      stderr.includes('Invalid --category'),
      `Public CLI stderr must reject tools. Got: ${stderr}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — build-experimental symmetric guards
// ---------------------------------------------------------------------------

describe('build-experimental — symmetric input guards', () => {
  let tempDir: string;

  before(() => {
    tempDir = path.join(os.tmpdir(), randomUUID());
    mkdirSync(tempDir, { recursive: true });
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('refuses an EXPERIMENTAL_DIR whose basename is not "experimental"', () => {
    const badDir = path.join(tempDir, 'articles');
    const catalogPath = path.join(tempDir, 'experimental-catalog.json');
    const linksPath = path.join(tempDir, 'experimental-links.json');
    mkdirSync(badDir, { recursive: true });
    initEmptyCatalog(catalogPath);
    initEmptyLinks(linksPath);

    const { exitCode, stderr } = runExperimentalBuild({
      experimentalDir: badDir,
      experimentalCatalogPath: catalogPath,
      experimentalLinksPath: linksPath,
      outDir: path.join(tempDir, 'dist'),
      basePath: '',
    });

    assert.notEqual(exitCode, 0, 'Build must refuse a non-experimental dir');
    assert.ok(
      stderr.includes('EXPERIMENTAL_DIR must resolve to a directory whose basename is exactly "experimental"'),
      `stderr must explain the guard. Got: ${stderr}`,
    );
  });

  it('refuses an EXPERIMENTAL_CATALOG_PATH whose basename does not start with "experimental-"', () => {
    const dir = path.join(tempDir, 'experimental');
    const badCatalog = path.join(tempDir, 'catalog.json');
    const linksPath = path.join(tempDir, 'experimental-links.json');
    mkdirSync(dir, { recursive: true });
    initEmptyCatalog(badCatalog);
    initEmptyLinks(linksPath);

    const { exitCode, stderr } = runExperimentalBuild({
      experimentalDir: dir,
      experimentalCatalogPath: badCatalog,
      experimentalLinksPath: linksPath,
      outDir: path.join(tempDir, 'dist'),
      basePath: '',
    });

    assert.notEqual(exitCode, 0, 'Build must refuse a non-experimental manifest');
    assert.ok(
      stderr.includes('EXPERIMENTAL_CATALOG_PATH must resolve to a file whose basename starts with "experimental-"'),
      `stderr must explain the guard. Got: ${stderr}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — Zero-leakage: public build is unaffected by experimental content
// ---------------------------------------------------------------------------

describe('public build — zero-leakage from experimental content', () => {
  let tempDir: string;
  let projectMirror: string;
  let publicArticles: string;
  let publicCatalog: string;
  let publicLinks: string;
  let experimentalDir: string;
  let experimentalCatalog: string;
  let experimentalLinks: string;
  let outA: string;
  let outB: string;

  before(() => {
    tempDir = path.join(os.tmpdir(), randomUUID());
    projectMirror = path.join(tempDir, 'project');
    publicArticles = path.join(projectMirror, 'articles');
    publicCatalog = path.join(projectMirror, 'data', 'catalog.json');
    publicLinks = path.join(projectMirror, 'data', 'links.json');
    experimentalDir = path.join(projectMirror, 'experimental');
    experimentalCatalog = path.join(projectMirror, 'data', 'experimental-catalog.json');
    experimentalLinks = path.join(projectMirror, 'data', 'experimental-links.json');
    outA = path.join(tempDir, 'distA');
    outB = path.join(tempDir, 'distB');

    mkdirSync(publicArticles, { recursive: true });
    mkdirSync(path.dirname(publicCatalog), { recursive: true });
    mkdirSync(experimentalDir, { recursive: true });

    // Snapshot the REAL public data into the temp project mirror. This is
    // the unmodified public catalog the build will see. We copy from the
    // running project root so the test reflects real-world data.
    const realCatalog = path.join(PROJECT_ROOT, 'data', 'catalog.json');
    const realLinks = path.join(PROJECT_ROOT, 'data', 'links.json');
    const realArticles = path.join(PROJECT_ROOT, 'articles');
    if (!existsSync(realCatalog)) {
      throw new Error(`Project catalog missing — cannot run zero-leakage test from ${realCatalog}`);
    }
    cpSync(realCatalog, publicCatalog);
    cpSync(realLinks, publicLinks);
    cpSync(realArticles, publicArticles, { recursive: true });

    initEmptyCatalog(experimentalCatalog);
    initEmptyLinks(experimentalLinks);
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('public build output is byte-identical whether experimental content exists or not', () => {
    // Run A: public build with NO experimental content.
    const a = runPublicBuild({
      articlesDir: publicArticles,
      catalogPath: publicCatalog,
      linksPath: publicLinks,
      outDir: outA,
      basePath: '',
    });
    assert.equal(a.exitCode, 0, `Public build A failed: ${a.stderr}`);
    const hashA = hashTree(outA);

    // Populate the experimental tree with content.
    const exA = runExperimentalCli(['--source', SAMPLE_WITH_IMG], {
      experimentalDir,
      experimentalCatalogPath: experimentalCatalog,
    });
    assert.equal(exA.exitCode, 0, `Experimental publish 1 failed: ${exA.stderr}`);
    const exB = runExperimentalCli(['--source', SAMPLE_WITH_IMG_2], {
      experimentalDir,
      experimentalCatalogPath: experimentalCatalog,
    });
    assert.equal(exB.exitCode, 0, `Experimental publish 2 failed: ${exB.stderr}`);

    // Run B: public build AGAIN, with experimental content now sitting
    // beside the public tree. The build env vars still point ONLY at the
    // public paths — so the output must be unchanged.
    const b = runPublicBuild({
      articlesDir: publicArticles,
      catalogPath: publicCatalog,
      linksPath: publicLinks,
      outDir: outB,
      basePath: '',
    });
    assert.equal(b.exitCode, 0, `Public build B failed: ${b.stderr}`);
    const hashB = hashTree(outB);

    assert.equal(
      hashA,
      hashB,
      'Public build output MUST be byte-identical before and after experimental content is added',
    );

    // Brand regression: the PUBLIC catalog page must still say "Agent News"
    // (not "Agent Content") regardless of any experimental rebrand.
    const publicIndexHtml = readFileSync(path.join(outB, 'index.html'), 'utf8');
    assert.ok(
      publicIndexHtml.includes('<title>Agent News</title>'),
      'Public index.html must still use <title>Agent News</title>',
    );
    assert.equal(
      publicIndexHtml.includes('Agent Content'),
      false,
      'Public index.html must NOT contain "Agent Content" (that brand is experimental-only)',
    );
    // And the public page must not render a Tools section.
    assert.equal(
      publicIndexHtml.includes('id="tools"'),
      false,
      'Public index.html must NOT render the Tools section',
    );
    // Public hero copy must remain unchanged: "News from the agent stack."
    // and the three-stream lede with no Tools mention.
    assert.ok(
      publicIndexHtml.includes('News from the') && publicIndexHtml.includes('agent stack.'),
      'Public index.html must still render the public hero title',
    );
    assert.ok(
      publicIndexHtml.includes('Three streams:'),
      'Public lede must still announce "Three streams:" (not "Four streams:")',
    );
    assert.equal(
      publicIndexHtml.includes('Four streams:'),
      false,
      'Public lede must NOT mention Four streams (that copy is experimental-only)',
    );
    assert.equal(
      publicIndexHtml.includes('<strong>Tools</strong>'),
      false,
      'Public lede must NOT mention Tools as a stream',
    );
    assert.equal(
      publicIndexHtml.includes('news from'),
      false,
      'Public hero must NOT contain the lowercase experimental "news from" phrasing',
    );
    // EXPERIMENTAL_URL was NOT set on this build invocation, so the public
    // hero must NOT contain the experiments link.
    assert.equal(
      publicIndexHtml.includes('+ a path to experiments'),
      false,
      'Public hero must NOT render the experiments link when EXPERIMENTAL_URL is unset',
    );
  });

  it('renders the experiments link in the public hero when EXPERIMENTAL_URL is set', () => {
    const outC = path.join(tempDir, 'distC');
    const exUrl = 'https://example.invalid/agentnews-experimental/';
    const result = spawnSync(
      'npx',
      ['tsx', path.join(PROJECT_ROOT, 'scripts', 'build-static.ts')],
      {
        env: {
          ...process.env,
          CATALOG_PATH: publicCatalog,
          ARTICLES_DIR: publicArticles,
          LINKS_PATH: publicLinks,
          BASE_PATH: '',
          OUT_DIR: outC,
          EXPERIMENTAL_URL: exUrl,
        },
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    assert.equal(
      result.status,
      0,
      `build-static with EXPERIMENTAL_URL set must succeed. stderr: ${result.stderr ?? ''}`,
    );
    const indexHtml = readFileSync(path.join(outC, 'index.html'), 'utf8');
    assert.ok(
      indexHtml.includes('+ a path to experiments'),
      'Public hero must render the experiments link text when EXPERIMENTAL_URL is set',
    );
    assert.ok(
      indexHtml.includes(`href="${exUrl}"`),
      `Public hero link must point at EXPERIMENTAL_URL=${exUrl}`,
    );
  });

  it('public dist contains no file sourced from the experimental tree', () => {
    // Read both manifests. A file in the public dist whose slug ALSO exists
    // in the experimental manifest is only "leakage" if the bytes on disk
    // came from the experimental source rather than the public source —
    // because nothing forbids the same slug being present in both manifests
    // (e.g. the test fixtures are shared between samples/ and articles/).
    const experimentalManifest = JSON.parse(readFileSync(experimentalCatalog, 'utf8')) as {
      entries: Array<{ slug: string; sha256: string }>;
    };
    const publicManifest = JSON.parse(readFileSync(publicCatalog, 'utf8')) as {
      entries: Array<{ slug: string; sha256: string }>;
    };

    if (experimentalManifest.entries.length === 0) {
      // The prior test in this suite populates the manifest. If the run
      // ordering changes and this suite runs first, skip cleanly rather
      // than flag a false positive.
      return;
    }

    const publicSlugs = new Set(publicManifest.entries.map((e) => e.slug));
    const publicShaBySlug = new Map(publicManifest.entries.map((e) => [e.slug, e.sha256]));

    for (const entry of experimentalManifest.entries) {
      const publicFile = path.join(outB, 'a', `${entry.slug}.html`);
      if (!publicSlugs.has(entry.slug)) {
        // Slug NOT in public catalog — its presence in the public dist would
        // be unambiguous leakage.
        assert.equal(
          existsSync(publicFile),
          false,
          `Public dist must not contain experimental slug "${entry.slug}" at ${publicFile}`,
        );
        continue;
      }
      // Slug DOES appear in the public catalog — the file must exist, but
      // its bytes must match the PUBLIC sha256, not the experimental one
      // (unless they happen to be identical, which is fine — same source).
      assert.ok(
        existsSync(publicFile),
        `Public dist must contain public slug "${entry.slug}" at ${publicFile}`,
      );
      const actualSha = sha256Hex(readFileSync(publicFile));
      const expectedPublicSha = publicShaBySlug.get(entry.slug);
      assert.equal(
        actualSha,
        expectedPublicSha,
        `Public dist file for shared slug "${entry.slug}" must match the PUBLIC catalog's sha256, not the experimental one`,
      );
    }

    // Defensive: assert the public catalog page only links to public slugs.
    const indexHtml = readFileSync(path.join(outB, 'index.html'), 'utf8');
    for (const entry of experimentalManifest.entries) {
      if (publicSlugs.has(entry.slug)) {
        // Shared slug — link is from the public catalog, expected.
        continue;
      }
      assert.equal(
        indexHtml.includes(`/a/${entry.slug}`),
        false,
        `Public catalog page must not link to experimental-only slug "${entry.slug}"`,
      );
    }
  });
});
