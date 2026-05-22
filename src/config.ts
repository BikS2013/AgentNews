/**
 * Application configuration loader.
 *
 * Per project convention: NO fallbacks. Every required env var that is
 * missing or invalid causes a thrown Error at startup.
 */

export interface AppConfig {
  port: number;
  articlesDir: string;
  catalogPath: string;
  linksPath: string;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const raw = env[name];
  if (raw === undefined || raw === null) {
    throw new Error(`Missing required env var: ${name}`);
  }
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return raw;
}

function parsePositiveInteger(name: string, raw: string): number {
  // Must be only digits (optionally preceded by + sign) — reject scientific
  // notation, decimals, hex, whitespace-padded numbers, etc.
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`Invalid ${name}: empty value`);
  }
  if (!/^\+?[0-9]+$/.test(trimmed)) {
    throw new Error(`Invalid ${name}: not a positive integer (got "${raw}")`);
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid ${name}: not a positive integer (got "${raw}")`);
  }
  if (n > 65535) {
    throw new Error(`Invalid ${name}: port out of range 1-65535 (got ${n})`);
  }
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const portRaw = requireEnv(env, 'PORT');
  const articlesDirRaw = requireEnv(env, 'ARTICLES_DIR');
  const catalogPathRaw = requireEnv(env, 'CATALOG_PATH');
  const linksPathRaw = requireEnv(env, 'LINKS_PATH');

  const port = parsePositiveInteger('PORT', portRaw);

  const articlesDir = articlesDirRaw.trim();
  if (articlesDir.length === 0) {
    throw new Error('Invalid ARTICLES_DIR: empty value');
  }

  const catalogPath = catalogPathRaw.trim();
  if (catalogPath.length === 0) {
    throw new Error('Invalid CATALOG_PATH: empty value');
  }

  const linksPath = linksPathRaw.trim();
  if (linksPath.length === 0) {
    throw new Error('Invalid LINKS_PATH: empty value');
  }

  return { port, articlesDir, catalogPath, linksPath };
}
