# Configuration Guide

This document is the single, authoritative reference for every configuration
variable consumed by the Agent News project — by the Fastify server, the
publishing CLIs, the static-export build scripts, and the GitHub Actions
workflows that deploy the public and the experimental sibling sites.

## Configuration sources & precedence

There are FIVE possible sources of configuration. From **lowest to highest**
priority (the higher source wins):

1. **Shell environment** at process startup (`process.env`).
2. **User-level config file** at `~/.tool-agents/<tool-name>/.env`
   (per-tool, per-user; conventionally `0600`).
3. **Project-local file** `.env` in the current working directory
   (per-project, per-checkout).
4. **CLI flags** on the invoking command (when applicable).
5. **GitHub Actions inputs/variables/secrets** when running under CI
   (`vars.*` and `secrets.*` references in the workflow file).

> **Important.** The code itself reads `process.env` directly. Tiers 2 and 3
> only take effect if you (or your shell, or your editor) load the `.env`
> files into the shell environment BEFORE invoking the command — for example
> via `set -a; source ~/.tool-agents/publish-experimental-article/.env; set +a`
> or a dotenv shell hook. Tier 4 (CLI flags) applies only to article-level
> options (`--source`, `--thumbnail-url`, `--update`, `--date`, `--category`);
> there are no CLI flags that override the env-var configuration of paths,
> port numbers, or deploy targets.

**No-fallback rule.** Every required variable below has NO default value. If
it is missing or empty when the consumer reads it, the consumer throws a
clear, named error and exits non-zero. This applies symmetrically to the
server, the CLIs, the build scripts, and the workflows.

---

## Public flow — server and `publish-article` / `publish-link`

These variables are required at startup by `src/server.ts` (via
`loadConfig()` in `src/config.ts`) and by the public CLIs.

| Variable        | Type                                     | Purpose                                                                                          | How to obtain                                                                              | Recommended storage                                  | Default      |
|-----------------|------------------------------------------|--------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------|------------------------------------------------------|--------------|
| `PORT`          | positive integer, 1–65535                | TCP port the Fastify server listens on.                                                          | Pick any free port; conventionally `3000`.                                                 | `.env` (local dev) or shell export                   | none (fatal) |
| `ARTICLES_DIR`  | non-empty string (relative or absolute)  | Directory holding published `<slug>.html` files in the public flow.                              | Project convention: `./articles`.                                                          | `.env`                                                | none (fatal) |
| `CATALOG_PATH`  | non-empty string (relative or absolute)  | Path to the public catalog JSON manifest.                                                        | Project convention: `./data/catalog.json`.                                                 | `.env`                                                | none (fatal) |
| `LINKS_PATH`    | non-empty string (relative or absolute)  | Path to the public links JSON manifest.                                                          | Project convention: `./data/links.json`.                                                   | `.env`                                                | none (fatal) |

Optional environment input:

| Variable          | Type   | Purpose                                                                                              | How to obtain                                                                                                | Recommended storage |
|-------------------|--------|------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|---------------------|
| `YOUTUBE_API_KEY` | string | When set AND the article's thumbnail is a YouTube URL, the CLI enriches the catalog entry with `youtubePublishedAt`. Same behaviour in `publish-article` and `publish-experimental-article`. Soft-skip on absence/failure (feature gating, NOT a configuration fallback). | Google Cloud Console → APIs & Services → Credentials → enable YouTube Data API v3 → create API key. | `~/.tool-agents/publish-article/.env` (user-level) or shell export. **Do NOT commit.** |

### Public static-export build (`scripts/build-static.ts`)

| Variable       | Type    | Purpose                                                                                  | Default      |
|----------------|---------|------------------------------------------------------------------------------------------|--------------|
| `CATALOG_PATH` | string  | Same as above.                                                                           | none (fatal) |
| `ARTICLES_DIR` | string  | Same as above.                                                                           | none (fatal) |
| `LINKS_PATH`   | string  | Same as above.                                                                           | none (fatal) |
| `BASE_PATH`    | string  | `""` for root host or `/<repo-name>` for a project Pages page. Empty string is allowed. | none (fatal) |
| `OUT_DIR`      | string  | Build output directory. Convention: `./dist`.                                            | none (fatal) |

### Public deploy workflow (`.github/workflows/deploy.yml`)

Uses `actions/deploy-pages@v4` against this repo's own Pages — no extra
secrets or variables are needed; the workflow declares its own `BASE_PATH`,
`CATALOG_PATH`, `ARTICLES_DIR`, `LINKS_PATH`, `OUT_DIR` inline.

---

## Experimental flow — `publish-experimental-article` and `build-experimental`

These variables are read directly by the experimental CLI and build script.
None of them overlap with the public-flow names; this is deliberate so that
the two pipelines cannot accidentally pick up each other's configuration.

| Variable                    | Type                                    | Purpose                                                                                                                                              | How to obtain                                              | Recommended storage                                            | Default      |
|-----------------------------|-----------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------|----------------------------------------------------------------|--------------|
| `EXPERIMENTAL_DIR`          | string (relative or absolute path)      | Directory holding experimental `<slug>.html` files. **MUST resolve to a path whose basename is exactly `experimental`**, otherwise the CLI/build refuses to run. | Project convention: `./experimental`.                      | `~/.tool-agents/publish-experimental-article/.env` or `.env`   | none (fatal) |
| `EXPERIMENTAL_CATALOG_PATH` | string (relative or absolute path)      | Path to the experimental catalog JSON. **MUST resolve to a file whose basename starts with `experimental-`**, otherwise the CLI/build refuses to run. | Project convention: `./data/experimental-catalog.json`.    | same as above                                                  | none (fatal) |
| `EXPERIMENTAL_LINKS_PATH`   | string (relative or absolute path)      | Path to the experimental links manifest. Kept structurally for parity with the public render; conventionally points at an empty links file.          | Project convention: `./data/experimental-links.json`.      | same as above                                                  | none (fatal) |

The build script additionally requires the standard `BASE_PATH` and
`OUT_DIR` (same semantics as the public build) — for the workflow,
`BASE_PATH=/<TARGET_REPO_NAME>` and `OUT_DIR=./dist-experimental`.

### Cross-repo publish workflow (`.github/workflows/publish-experimental.yml`)

Required **repository variables** (Settings → Variables → Actions):

| Variable             | Type          | Purpose                                                                                                                  | How to obtain                                                                                          | Recommended storage |
|----------------------|---------------|--------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|---------------------|
| `TARGET_REPO_OWNER`  | string        | GitHub user or organisation that owns the target (sibling) repo where the experimental site is published.                | Your GitHub username or org login.                                                                     | repo variable       |
| `TARGET_REPO_NAME`   | string        | Name of the target repo.                                                                                                 | The repo you create manually beforehand (e.g. `agent-news-experimental`).                              | repo variable       |
| `TARGET_BRANCH`      | string        | Branch the workflow force-pushes the built artifact to. **Refuses `main` or `master`** as a safety check.                | Recommended literal: `gh-pages`. (Must still be set; absence is fatal.)                                | repo variable       |
| `GH_PAT_EXPIRES_AT`  | ISO-8601 date | Expiration date of the PAT, used by the workflow to emit a proactive `::warning::` annotation when close to expiry, and to fail the run hard once expired. | When you mint the PAT below, copy its expiration date verbatim.                                        | repo variable       |
| `GH_PAT_WARN_DAYS`   | integer       | Days-until-expiry threshold below which the workflow starts emitting warnings.                                           | Recommended: `14`.                                                                                     | repo variable       |

Required **repository secret** (Settings → Secrets → Actions):

| Variable | Type            | Purpose                                                              | How to obtain                                                                                                                                                | Recommended storage |
|----------|-----------------|----------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------|
| `GH_PAT` | string (secret) | Fine-grained Personal Access Token used to push the built artifact. | GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → "Generate new token" → Resource owner: target repo's owner → Repository access: "Only select repositories" → pick the target repo → Permissions → Repository permissions → **Contents: Read and write** → set an expiration date and copy it into `GH_PAT_EXPIRES_AT`. | repo secret (NEVER commit) |

#### PAT scope and rotation

- **Scope:** Fine-grained PAT, scoped to the SINGLE target repository with
  `contents: write`. Do NOT use a classic PAT — it grants too much.
- **Expiration:** GitHub fine-grained PATs have a maximum expiration of
  1 year. Recommended cadence: 90 days for shorter exposure window.
- **Rotation:** Mint the new PAT BEFORE the old one expires; update both
  `GH_PAT` (secret) and `GH_PAT_EXPIRES_AT` (variable) in the same session;
  delete the old PAT from your GitHub account.
- **Warning mechanism:** `GH_PAT_WARN_DAYS` controls how early the workflow
  shouts. Set to `14` for casual maintenance; `30` if you tend to deploy
  rarely; `7` if you deploy often and don't want noisy warnings.

#### What the preflight step asserts (in order, before any network call)

1. Every required variable/secret above is set AND non-empty.
2. `TARGET_BRANCH` is NOT `main` or `master` (safety guard against
   force-pushing into a default branch).
3. `GH_PAT_EXPIRES_AT` parses as a valid date AND is in the future.
4. Days-until-expiry vs `GH_PAT_WARN_DAYS` (only emits warning, not fatal).

If any of 1–3 fail, the workflow exits 1 immediately and nothing else runs.

---

## Triggering the workflow

The `publish-experimental` workflow runs in two modes:

- **Automatic on push** to `main`, filtered to changes under any of
  `experimental/**`, `data/experimental-catalog.json`,
  `data/experimental-links.json`, `scripts/build-experimental.ts`, or the
  workflow file itself. Unrelated commits do not trigger it.
- **Manual via the Actions tab** (`workflow_dispatch`) — useful for the first
  run, for re-publishing after fixing a configuration variable, or for a
  no-op publish.

A `concurrency` group serialises runs so two near-simultaneous pushes cannot
race the force-push.

---

## What happens on first run (one-time bootstrap)

The user (not the workflow) must complete the following BEFORE the first
publish run can succeed:

1. **Create the target repo** on GitHub. The repo can be public or private —
   for a private repo, GitHub Pages on non-Enterprise plans serves the site
   publicly regardless of repo visibility (you still get the
   privacy-by-obscurity property documented in the README's "Privacy
   posture" section).
2. **Enable GitHub Pages** on the target repo, sourced from the
   `TARGET_BRANCH` (default recommendation `gh-pages`). On a brand-new repo
   the branch does not yet exist — the workflow creates it on first run
   (as an orphan branch) if it is missing.
3. **Mint the fine-grained PAT** with the scope above and copy its
   expiration date.
4. **Set the variables and the secret** listed in the table above on the
   `agent-news` repo (Settings → Variables / Secrets → Actions).
5. **Trigger the workflow manually** from the Actions tab to validate the
   end-to-end path. The deployed URL will be
   `https://<TARGET_REPO_OWNER>.github.io/<TARGET_REPO_NAME>/` once Pages
   has finished the build (usually within a couple of minutes).
6. **Update `Issues - Pending Items.md`** to mark the "target repo identity"
   and "PAT expiration" items as resolved.

---

## Variables NOT used by this project

To prevent confusion: this project deliberately does NOT consume the eight
canonical LLM provider env vars (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`GOOGLE_API_KEY`, `AZURE_OPENAI_*`, `AZURE_AI_INFERENCE_*`, `OLLAMA_HOST`,
`LITELLM_*`). The publishing pipeline never calls an LLM. The only external
API integration is the optional YouTube Data API used for video-publish-date
enrichment, gated on `YOUTUBE_API_KEY`.
