# Plan 002 — Experimental sibling-publish flow

## Provenance

- **Refined request**: `docs/reference/refined-request-experimental-sibling-publish.md`
- **Codebase scan**: `docs/reference/codebase-scan-experimental-sibling-publish.md` (last scanned commit `3d082f99f1a7651569a38c700f7164f69a3a641f`)
- **Investigation**: skipped — single obvious approach (clone the existing article/build flow into a parallel pipeline; cross-repo push via PAT in GitHub Actions).
- **Technical research**: skipped — no new technology; reuses existing TypeScript/Fastify/tsx stack and standard `git push` to a sibling repo.
- **Plan ID**: 002 (next after `plan-001-html-article-publishing-site.md`).

## User-confirmed decisions

| # | Decision |
|---|---|
| 1 | New top-level folder is `experimental/` (sibling to `articles/`). |
| 2 | Content is byte-identical standalone HTML, same contract as `articles/`. |
| 3 | A **separate** authoring CLI `publish-experimental-article` is scaffolded; existing `publish-article` is untouched. |
| 4 | Cross-repo publish via a new GitHub Action triggered on `workflow_dispatch` AND on `push` to `main` path-filtered to `experimental/**` and `data/experimental-catalog.json`. |
| 5 | Experimental Pages site MIRRORS the main site: it has its own catalog/index page listing every experimental article. |
| 6 | Privacy is by unadvertised URL only — no auth, no access control. Trade-off explicitly accepted. |
| 7 | Target repo will be created manually by the user; its `owner`, `name`, and `branch` are configuration parameters, never hard-coded. |

## Deferred-to-config (placeholders in the plan; user fills in at deploy time)

- `TARGET_REPO_OWNER` (repository variable)
- `TARGET_REPO_NAME` (repository variable)
- `TARGET_BRANCH` (repository variable; recommended literal value `gh-pages` documented in the guide, but never substituted as a default — missing value = fatal)
- `GH_PAT` (repository secret; fine-grained PAT scoped to the target repo with `contents:write`)
- `GH_PAT_EXPIRES_AT` (repository variable; ISO-8601 date for the expiration warning)
- `GH_PAT_WARN_DAYS` (repository variable; integer, e.g. `14`)

## Scope summary

Add a complete second publish pipeline that lives beside the existing one and never touches it. Source content goes in `experimental/`, manifest in `data/experimental-catalog.json`, authored via a brand-new CLI, built by a brand-new build script, and pushed to a sibling repository by a brand-new GitHub Action. The existing public flow remains byte-for-byte unchanged.

---

## Files & symbols

### New files

| Path | Purpose |
|---|---|
| `experimental/.gitkeep` | Establishes the folder; tracked initially empty. |
| `data/experimental-catalog.json` | Parallel manifest. Initial body: `{ "schemaVersion": 1, "entries": [] }`. |
| `data/experimental-links.json` | Empty parallel links manifest so the experimental build can reuse the existing `renderCatalogHtml` signature without forking it. Initial body: `{ "schemaVersion": 1, "entries": [] }`. (Forced by `renderCatalogHtml(entries, { links, basePath })` — see codebase scan §4.) |
| `src/cli/publish-experimental-article.ts` | Clone of `src/cli/publish-article.ts`, retargeted at `experimental/` + `data/experimental-catalog.json`. |
| `scripts/build-experimental.ts` | Clone of `scripts/build-static.ts`, retargeted at the experimental manifest and an `OUT_DIR` of its own. |
| `.github/workflows/publish-experimental.yml` | Cross-repo publish workflow. |
| `docs/tools/publish-experimental-article.md` | Tool documentation file scaffolded via `/tool-conventions scaffold publish-experimental-article`. |
| `docs/design/configuration-guide.md` | New configuration guide covering ALL env vars (existing + new). |
| `test_scripts/experimental-build.test.ts` | Byte-identity + zero-leakage regression tests. |

### Modified files

| Path | Change |
|---|---|
| `package.json` | Add scripts: `"publish-experimental-article": "tsx src/cli/publish-experimental-article.ts"` and `"build:experimental": "tsx scripts/build-experimental.ts"`. No removals, no version bumps, no new dependencies. |
| `.gitignore` | No change — experimental content is committed; nothing here is private at the repo level. (Verified: the user's last clarification was "i dont want the data to be private, i just want for them to not be visible through the pages unless the user is a repo member" — which we now interpret as "not on the public Pages site". The source files remain committed.) |
| `CLAUDE.md` | Add a Tools/Workflows reference entry pointing to `docs/tools/publish-experimental-article.md` and a short description of the cross-repo publish workflow. |
| `README.md` | Add an "Experimental sibling site" section explaining the authoring flow, the publish trigger, and the privacy trade-off. |
| `docs/design/project-design.md` | New "Experimental sibling publish" subsection citing this plan, the refined request, and the codebase scan. |
| `docs/design/project-functions.md` | Register the experimental publish feature as a functional requirement (FR-NN). |
| `Issues - Pending Items.md` | Add open items for the deferred decisions (target repo name, PAT details) plus a Dependency-vetting-log line stating "No new runtime deps introduced — only adds two scripts that reuse the existing toolchain." |

### Files explicitly NOT modified (regression risk)

- `src/cli/publish-article.ts`
- `src/cli/publish-link.ts`
- `src/server.ts`, `src/server/**`
- `src/config.ts`
- `src/catalog/**`, `src/links/**`, `src/extractor/**`
- `scripts/build-static.ts`
- `scripts/refresh-youtube-dates.ts`
- `data/catalog.json`, `data/links.json`
- `articles/**`
- `.github/workflows/deploy.yml`

The "Public regression" acceptance criterion is enforced by leaving these untouched and by the new test in `test_scripts/experimental-build.test.ts`.

---

## Step-by-step execution

### Step 1 — Folder + manifest scaffolding

1.1 Create `experimental/` with a tracked `.gitkeep`.
1.2 Create `data/experimental-catalog.json` with `{ "schemaVersion": 1, "entries": [] }`.
1.3 Create `data/experimental-links.json` with `{ "schemaVersion": 1, "entries": [] }`.

No code touched yet. Verifiable with `ls experimental/` and `cat data/experimental-catalog.json`.

### Step 2 — New authoring CLI (`publish-experimental-article`)

2.1 Scaffold the tool documentation file via `/tool-conventions scaffold publish-experimental-article`. This produces `docs/tools/publish-experimental-article.md` and the `~/.tool-agents/publish-experimental-article/` config folder per the project's tool conventions. Do NOT hand-author either.

2.2 Create `src/cli/publish-experimental-article.ts` by cloning `src/cli/publish-article.ts` verbatim and making the following targeted edits — and ONLY these edits:

| Location in original | Change |
|---|---|
| Config loading (`loadConfig()` call near `:317`) | Replace with direct `requireEnv('EXPERIMENTAL_DIR')` and `requireEnv('EXPERIMENTAL_CATALOG_PATH')` calls. Do NOT extend `src/config.ts` — the CLI loads its own vars (matches the existing pattern in `scripts/build-static.ts`). |
| `articlesDir` variable | Rename to `experimentalDir` throughout. |
| `catalogPath` variable | Rename to `experimentalCatalogPath` throughout. |
| `entry.articlePath` value | `experimental/${slug}.html` instead of `articles/${slug}.html`. |
| CLI banner / help text | Reference the new command name. |
| Defensive guard | Before any write, assert that `experimentalDir` resolves to a path whose basename is `experimental` and that `experimentalCatalogPath`'s basename starts with `experimental-`. Throw `UsageError` with a named message otherwise. This is the single-writer enforcement. |

The `atomicWriteFile`, `sha256Hex`, and `extractArticleMetadata` calls remain identical — byte-identity contract carries over verbatim.

2.3 Add `"publish-experimental-article": "tsx src/cli/publish-experimental-article.ts"` to `package.json` scripts.

2.4 Smoke-test: place a sample HTML in a tmp dir, run the new CLI with `EXPERIMENTAL_DIR` + `EXPERIMENTAL_CATALOG_PATH` pointing at temp paths, assert the temp manifest contains one entry and the temp folder contains the byte-identical HTML. (Test will be formalised in Step 6.)

### Step 3 — New build script (`build-experimental`)

3.1 Create `scripts/build-experimental.ts` by cloning `scripts/build-static.ts` verbatim and making the following targeted edits:

| Location | Change |
|---|---|
| Env vars: `requireNonEmpty('CATALOG_PATH')` | Replace with `requireNonEmpty('EXPERIMENTAL_CATALOG_PATH')`. |
| Env vars: `requireNonEmpty('ARTICLES_DIR')` | Replace with `requireNonEmpty('EXPERIMENTAL_DIR')`. |
| Env vars: `requireNonEmpty('LINKS_PATH')` | Replace with `requireNonEmpty('EXPERIMENTAL_LINKS_PATH')`. The workflow passes `data/experimental-links.json` (the empty file from Step 1.3). |
| Env vars: `requireNonEmpty('OUT_DIR')` | Same name, but the workflow points it at a different temp directory (e.g. `dist-experimental/`). |
| `BASE_PATH` | Same env var. The workflow sets it to `/<TARGET_REPO_NAME>` (since GitHub Pages on a project repo serves from `https://<owner>.github.io/<repo>/`). |
| Catalog read & validation | Same `isCatalogFile` parser. The schema is shared. |
| Article file iteration | Reads from `experimentalDir` instead of `articlesDir`. SHA-256 verification stays identical. |
| Output emission | `dist-experimental/a/<slug>.html`, `dist-experimental/index.html`, `dist-experimental/404.html`, `dist-experimental/.nojekyll`. Output path layout matches the main site so the catalog page works unchanged. |

3.2 Add `"build:experimental": "tsx scripts/build-experimental.ts"` to `package.json` scripts.

3.3 Sanity check by running locally: `EXPERIMENTAL_DIR=experimental EXPERIMENTAL_CATALOG_PATH=data/experimental-catalog.json EXPERIMENTAL_LINKS_PATH=data/experimental-links.json BASE_PATH=/ OUT_DIR=dist-experimental npm run build:experimental` should produce an empty-catalog `dist-experimental/index.html` and no errors when the manifest has zero entries.

### Step 4 — GitHub Action (`publish-experimental.yml`)

4.1 Create `.github/workflows/publish-experimental.yml` with this skeleton (concrete YAML to be written; logic captured here):

- **Name**: `Publish experimental site`
- **Triggers**:
  - `workflow_dispatch` (manual)
  - `push` on `main` filtered to paths: `experimental/**`, `data/experimental-catalog.json`, `data/experimental-links.json`, `scripts/build-experimental.ts`, `.github/workflows/publish-experimental.yml`
- **Permissions**: `contents: read` on the source repo (default). The target repo write happens via `GH_PAT`, not via the default `GITHUB_TOKEN`.
- **Job: `publish`** running on `ubuntu-latest`:
  1. **Preflight (fail-fast)** — first step is a `bash` script that asserts each of `TARGET_REPO_OWNER`, `TARGET_REPO_NAME`, `TARGET_BRANCH`, `GH_PAT` is set and non-empty. Exits 1 with a named error message if any is missing. This step runs BEFORE checkout, BEFORE any network call. Per the project's no-fallback rule.
  2. **PAT expiration warning** — second `bash` step computes days-until-expiry from `GH_PAT_EXPIRES_AT`; if within `GH_PAT_WARN_DAYS` (default `14`), emits `::warning::` annotation. Missing `GH_PAT_EXPIRES_AT` is itself a fatal error (no defaults).
  3. `actions/checkout@v4` of the source repo.
  4. `actions/setup-node@v4` with `node-version: 20`.
  5. `npm ci`.
  6. `npm run build:experimental` with env: `EXPERIMENTAL_DIR=experimental`, `EXPERIMENTAL_CATALOG_PATH=data/experimental-catalog.json`, `EXPERIMENTAL_LINKS_PATH=data/experimental-links.json`, `BASE_PATH=/${{ vars.TARGET_REPO_NAME }}/`, `OUT_DIR=dist-experimental`.
  7. **Cross-repo push** — clone the target repo into `_target/` using `https://x-access-token:${GH_PAT}@github.com/${TARGET_REPO_OWNER}/${TARGET_REPO_NAME}.git`, checkout `TARGET_BRANCH` (create as orphan if it does not exist), `rsync` `dist-experimental/` over its working tree (deleting orphaned files), commit with message `chore(experimental): publish from agent-news@${{ github.sha }}`, and push. Use a bot identity (`actions@github.com`) for the commit.
  8. **Post-condition assertion** — `git log -1` on `_target/` to confirm the commit landed; emit `::notice::` with the resulting commit SHA.
- **Secrets and variables consumed**: `secrets.GH_PAT`, `vars.TARGET_REPO_OWNER`, `vars.TARGET_REPO_NAME`, `vars.TARGET_BRANCH`, `vars.GH_PAT_EXPIRES_AT`, `vars.GH_PAT_WARN_DAYS`.

4.2 The workflow file MUST be reviewed by the user before first run, since misconfigured push permissions could write to an unintended repo. The plan does not auto-run it.

### Step 5 — Documentation

5.1 `docs/tools/publish-experimental-article.md` — scaffolded by `/tool-conventions scaffold` in Step 2.1; fill in tool-specific sections.

5.2 `docs/design/configuration-guide.md` — new file covering:
- Existing public env vars (`PORT`, `ARTICLES_DIR`, `CATALOG_PATH`, `LINKS_PATH`, `BASE_PATH`, `OUT_DIR`).
- New experimental env vars (`EXPERIMENTAL_DIR`, `EXPERIMENTAL_CATALOG_PATH`, `EXPERIMENTAL_LINKS_PATH`).
- New CI vars/secrets (`TARGET_REPO_OWNER`, `TARGET_REPO_NAME`, `TARGET_BRANCH`, `GH_PAT`, `GH_PAT_EXPIRES_AT`, `GH_PAT_WARN_DAYS`).
- Precedence: env var > nothing (no `.env` default substitution); missing = fatal.
- PAT expiration mechanism, how to mint a fine-grained PAT, recommended rotation cadence.

5.3 `CLAUDE.md` — add Tools section entry:

> **publish-experimental-article** — CLI that publishes a byte-identical HTML article to the experimental sibling site (folder `experimental/`, manifest `data/experimental-catalog.json`). Mirrors the public `publish-article` flow but writes ONLY to experimental targets. See `docs/tools/publish-experimental-article.md`.

5.4 `README.md` — add an "Experimental sibling site" section.

5.5 `docs/design/project-design.md` — describe the parallel pipeline as a separate diagram block and cite the refined request, scan, and this plan.

5.6 `docs/design/project-functions.md` — append a new functional requirement: "FR-XX — Author HTML deep-dives publishable to a sibling GitHub Pages site separate from the public site."

5.7 `Issues - Pending Items.md` — add pending items:
- "Target repo identity not yet provided — PAT cannot be issued and workflow cannot run until `TARGET_REPO_OWNER`/`TARGET_REPO_NAME` are set in repository variables."
- "PAT expiration date not yet captured — `GH_PAT_EXPIRES_AT` must be set before first workflow run."
- Dependency-vetting-log entry: `2026-05-23: experimental sibling publish — no new runtime deps introduced.`

### Step 6 — Regression + smoke tests

6.1 Create `test_scripts/experimental-build.test.ts` modelled on `test_scripts/publish-cli-byte-identity.test.ts`. Cases:

| Case | Assertion |
|---|---|
| `publishes byte-identical experimental article` | After running the new CLI against a temp `EXPERIMENTAL_DIR` + manifest, the file under `experimental/` equals the source byte-for-byte AND its SHA-256 matches the manifest entry. |
| `experimental CLI refuses to write into articles/` | With `EXPERIMENTAL_DIR=<tmp>/articles` (basename collision), the CLI throws `UsageError` and exits non-zero. |
| `experimental CLI refuses to write a non-experimental manifest` | With `EXPERIMENTAL_CATALOG_PATH=<tmp>/catalog.json`, throws `UsageError`. |
| `build-experimental emits each entry byte-identically` | After populating a temp manifest + folder, running `build-experimental.ts` produces `dist/a/<slug>.html` whose bytes equal the source. |
| `build-experimental zero-leakage into public build` | Run `build-static.ts` (public) against a snapshot whose `data/catalog.json` is empty BUT whose `data/experimental-catalog.json` has entries; assert the public `dist/` contains zero `experimental/` files, zero references to experimental slugs in `dist/index.html`, and the rendered HTML diff against a baseline equals empty. |
| `public build byte-identical pre/post feature` | Snapshot existing `dist/` from `npm run build:static` on the current `articles/`+`catalog.json`; rerun after this feature is merged; SHA-256 of every emitted file must be identical. |

6.2 Add to `npm test` automatically (the existing pattern is `tsx --test test_scripts/*.test.ts`, so just dropping the file in picks it up).

### Step 7 — Pre-merge gate

7.1 Run `npm run typecheck` — must pass with zero errors.
7.2 Run `npm test` — all existing tests plus new ones pass.
7.3 Run `npm run build:static` against the unchanged `articles/`+`catalog.json` and verify the public regression test (Case "public build byte-identical pre/post feature") passes.
7.4 Run `npm run build:experimental` against an empty experimental manifest and verify it produces a coherent (if empty) catalog page.
7.5 Lint `.github/workflows/publish-experimental.yml` with `actionlint` (if installed) or at minimum visual review by user.

### Step 8 — First run (USER-driven, not automated)

The plan does NOT include actually creating the target repo, minting the PAT, or running the workflow. After merge, the user must:

1. Create the target GitHub repository (e.g. `agent-news-experimental`).
2. Enable GitHub Pages on its `gh-pages` branch (after the first publish creates it).
3. Mint a fine-grained PAT scoped to that single repo with `contents:write`.
4. Add the repository secret `GH_PAT` and the variables `TARGET_REPO_OWNER`, `TARGET_REPO_NAME`, `TARGET_BRANCH`, `GH_PAT_EXPIRES_AT`, `GH_PAT_WARN_DAYS` to the `agent-news` repo.
5. Trigger the workflow manually once via `workflow_dispatch`.
6. Verify the deployed site at `https://<owner>.github.io/<target-repo>/`.
7. Update `Issues - Pending Items.md` to close the "target repo identity" and "PAT expiration" items.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Cloning `publish-article.ts` creates a divergence-prone duplicate. | Step 6.1 covers byte-identity regression. Both CLIs share imports from `src/catalog/` and `src/extractor/` so the core logic is centralised. Future refactor (out of scope for this plan) can extract the shared core into `src/cli/publish-common.ts`. |
| Misconfigured PAT could push to an unintended repo. | Workflow's preflight asserts `TARGET_REPO_OWNER` and `TARGET_REPO_NAME` explicitly; no default substitution. Fine-grained PAT scoped to a single repo limits blast radius. User reviews `publish-experimental.yml` before first run. |
| GitHub Pages caches old content. | Force-push to `TARGET_BRANCH` so history is replaced atomically each run; Pages picks up the new commit within minutes. |
| Cross-repo push fails silently. | Step 4.1 includes a post-condition assertion that emits a `::notice::` with the commit SHA. Workflow exits non-zero if the push fails. |
| Test for "byte-identical pre/post feature" requires a snapshot. | Snapshot taken from current `HEAD` (commit `3d082f99...`) before any work begins; stored under `test_scripts/__fixtures__/public-build-baseline/` (gitignored, regenerated locally) — OR computed at test runtime by building twice and diffing. Plan defers the choice to the implementer; both are acceptable. |
| `LINKS_PATH` requirement forces an empty `data/experimental-links.json`. | Step 1.3 creates the file. Future enhancement to make `LINKS_PATH` optional in `build-static.ts` is out of scope. |

## Acceptance criteria — full traceback to refined request

| AC | Verification |
|---|---|
| AC1: End-to-end publish | Manual: after Step 8, fetch a published file from target Pages URL and `sha256sum` against the source in `experimental/`. |
| AC2: Public site purity | Automated test case "build-experimental zero-leakage into public build" (Step 6.1). |
| AC3: Fail-fast configuration | Workflow preflight step (Step 4.1 §1). Manual: trigger workflow with missing var, assert it exits 1 before checkout. |
| AC4: Public regression | Automated test case "public build byte-identical pre/post feature" (Step 6.1). |
| AC5: Documentation completeness | All files listed in Step 5 present in the merged tree. |
| AC6: PAT expiration warning | Workflow preflight step (Step 4.1 §2). Manual: set `GH_PAT_EXPIRES_AT` to a date within 14 days, trigger workflow, assert warning annotation appears in log. |

## Open items reserved for the user

These are NOT blockers for this plan; they ARE blockers for Step 8:

1. Exact target repo `<owner>/<name>`.
2. Exact `GH_PAT_EXPIRES_AT` date (and acceptance of the proposed 14-day warning threshold).
3. Acceptance of "force-push to target branch on every run" as the deployment semantics (alternative: incremental commits — explicitly NOT recommended because force-push gives a clean, deterministic state).
