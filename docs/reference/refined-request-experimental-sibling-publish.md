# Refined Request: Experimental Sibling Publish Flow

## Category
Development (with Infrastructure / CI configuration)

## Objective
Introduce a new top-level `experimental/` folder in the `agent-news` repository that collects YouTube deep-dives and articles the user wants to publish to the GitHub Pages site of a SEPARATE, user-owned GitHub repository (the "target repo"). The experimental content must be excluded from the main `agent-news` public Pages site, must follow the same byte-identity contract as the current `articles/` flow, and must be pushed cross-repo by a GitHub Action that uses a PAT-based secret. The existing public articles flow must remain bit-for-bit unchanged.

## Scope

### In scope
1. New top-level folder `experimental/` at the repo root, holding byte-identical standalone HTML files (same authoring contract as `articles/`).
2. Parallel catalog manifest for the experimental site (e.g. `data/experimental-catalog.json`), structurally analogous to `data/catalog.json` but disjoint from it.
3. Experimental-site build step that produces a deployable static artifact containing ONLY the experimental content (e.g. a new `npm run build:experimental` script, or an equivalent flag on `build:static`). The artifact must preserve byte-identity for every HTML file in `experimental/`.
4. Exclusion logic in the main `build:static` pipeline that guarantees nothing from `experimental/`, `data/experimental-catalog.json`, or any derived experimental artifact ever appears in the main `agent-news` Pages output (no files, no catalog entries, no sitemap entries, no internal links).
5. A new GitHub Actions workflow under `.github/workflows/` (e.g. `publish-experimental.yml`) that:
   - Checks out `agent-news`.
   - Runs the experimental build.
   - Pushes the resulting artifact to the target repo's configured branch (default `gh-pages`) using a PAT stored as a repository secret.
   - Fails fast and loudly when any required configuration value (PAT, target repo owner, target repo name) is missing — no defaults, no fallback substitutions.
6. Configuration surface:
   - `TARGET_REPO_OWNER` — workflow input or repository variable
   - `TARGET_REPO_NAME` — workflow input or repository variable
   - `TARGET_BRANCH` — workflow input or repository variable (recommended default value documented as `gh-pages`, but absent value = fatal error per the project's no-fallback rule)
   - `GH_PAT` — repository secret holding a fine-grained PAT scoped to the target repo with `contents:write`
   - `GH_PAT_EXPIRES_AT` — repository variable capturing the PAT expiration date, surfaced by the workflow as a warning when within N days of expiry (consistent with the project's configuration-guide convention for expiring tokens)
7. Documentation updates:
   - `CLAUDE.md` — add a concise reference entry for the new experimental flow and any new CLI/workflow under the Tools/Workflows section, pointing at the dedicated docs file under `docs/`.
   - `README.md` — describe how to author experimental content, the privacy trade-off, and how to trigger the cross-repo publish.
   - `docs/design/project-design.md` — capture the new module/flow and cite this refined-request file.
   - `docs/design/project-functions.md` — register the experimental publish feature as a functional requirement.
   - `docs/design/configuration-guide.md` (create or update) — document each new configuration parameter per the project's configuration-guide rules, including the PAT expiration warning mechanism.
   - `Issues - Pending Items.md` — add any open items, plus a "Dependency vetting log" entry if any new dependency is introduced.
8. Regression-test coverage under `test_scripts/` to assert: (a) the public `build:static` output is byte-identical before and after the change for all current articles; (b) no file from `experimental/` and no key from `data/experimental-catalog.json` appears in the public build output; (c) the experimental build emits each `experimental/*.html` byte-identically.

### Out of scope
- Authentication, OAuth, GitHub identity gating, signed URLs, or any access-control layer for the experimental site (privacy is by unadvertised URL only).
- Encryption of HTML payloads at rest or in transit beyond what GitHub Pages already provides.
- Any change to the existing `articles/` directory, `data/catalog.json`, `src/cli/publish-article.ts`, the Fastify server, the existing `build:static` semantics for public content, the existing `publish-link` and `refresh-youtube-dates` CLIs, or the byte-identity invariant of the public flow.
- Creating the target GitHub repository itself (the user creates it manually — see Constraints).
- Hosting the experimental site anywhere other than the target repo's GitHub Pages.
- Migration tools to move existing public articles into `experimental/` (or vice versa).
- Multi-target publishing (only ONE target repo is in scope; if multi-target is needed later, that is a follow-up refinement).

## Requirements

1. **Folder convention.** The repo MUST expose a top-level folder named exactly `experimental/`. Each file inside it MUST be a standalone HTML file authored under the same byte-identity contract as files in `articles/`.
2. **Parallel manifest.** A manifest file (e.g. `data/experimental-catalog.json`) MUST track the experimental content. Its schema MUST be defined explicitly and MUST NOT overlap with `data/catalog.json`.
3. **Authoring CLI.** Authors MUST be able to add a new file to `experimental/` and its manifest entry through a CLI mechanism (either an extended `publish-article` with an opt-in flag, or a separate `publish-experimental-article` CLI — final choice is an Open Question). The chosen mechanism MUST refuse to write into `articles/`/`data/catalog.json` when used in experimental mode, and vice versa.
4. **Build separation.** Two independent static builds MUST exist:
   - The PUBLIC build (`build:static`) MUST exclude every artifact derived from `experimental/`.
   - The EXPERIMENTAL build MUST include ONLY artifacts derived from `experimental/` (no public articles bleed-through).
5. **Byte-identity invariant.** For every `experimental/<file>.html` source, the bytes served by the target repo's Pages MUST equal the bytes on disk in `agent-news`. Same guarantee that already applies to `articles/` in the public flow.
6. **Cross-repo publish workflow.** A GitHub Action MUST push the experimental build artifact to `<TARGET_REPO_OWNER>/<TARGET_REPO_NAME>` on branch `<TARGET_BRANCH>` using `GH_PAT`. The workflow MUST NOT push to any other repo.
7. **No fallback configuration.** When any of `TARGET_REPO_OWNER`, `TARGET_REPO_NAME`, `TARGET_BRANCH`, or `GH_PAT` is missing, the workflow MUST fail with a clear error before attempting any network operation. NO default substitution.
8. **PAT expiration awareness.** The workflow MUST surface a warning when `GH_PAT_EXPIRES_AT` is within a configurable threshold (e.g. 14 days), aligned with the project's configuration-guide expiration rule.
9. **Exclusion enforcement.** A test under `test_scripts/` MUST mechanically verify that the public build artifact contains zero references to `experimental/` content (no HTML files, no catalog keys, no sitemap entries, no internal links).
10. **Documentation completeness.** All documentation updates listed in the In-Scope section MUST be present and consistent before the feature is considered done.
11. **Backwards compatibility.** Running `npm run build:static` BEFORE and AFTER this change against the current `articles/` tree MUST produce byte-identical output for every file currently emitted.

## Constraints

- **Technology.** Node.js 20+, TypeScript, ESM, Fastify 5 (server unchanged). Any new tool code MUST be TypeScript per the project rule.
- **Tooling conventions.** Any new CLI or reusable script MUST be scaffolded via `/tool-conventions scaffold <tool-name>` and documented under `docs/tools/<tool-name>.md`. Do NOT hand-author the documentation/config folder.
- **No-fallback rule.** Missing configuration values MUST raise a clear, fatal error. No default substitutions.
- **Read-only invariants.** `src/cli/publish-article.ts` is the only writer to `articles/`/`data/catalog.json`. Do not introduce a second writer to those locations.
- **Prerequisite: target repo creation.** The user MUST manually create the target GitHub repository, enable GitHub Pages on its `gh-pages` branch, and mint the PAT before the workflow can succeed. This is a one-time, user-performed step and is NOT automated.
- **Dependency vetting.** If any new runtime dependency is introduced (e.g. a Pages-deploy helper, a git CLI wrapper), the project's dependency-vetting procedure MUST be followed and the result recorded in `Issues - Pending Items.md`.
- **Privacy model.** Privacy is achieved purely by living on a different, unadvertised Pages URL. There is no authentication and no access control. Any visitor who learns or guesses the target Pages URL can read the experimental content. The user has explicitly accepted this trade-off (see Assumptions).

## Acceptance Criteria

1. **End-to-end publish.** Adding a new file (via the chosen authoring CLI) under `experimental/foo.html`, then triggering the GitHub Action, results in `https://<TARGET_REPO_OWNER>.github.io/<TARGET_REPO_NAME>/.../foo.html` (path layout TBD per Open Question 2) serving bytes IDENTICAL to `experimental/foo.html` on disk. Verified via `sha256sum` or equivalent diff.
2. **Public site purity.** After the change, the deployed `agent-news` main Pages site contains zero references to any file under `experimental/` and zero entries derived from `data/experimental-catalog.json`. Verified by an automated test under `test_scripts/` that scans the public build output.
3. **Fail-fast configuration.** Running the GitHub Action with any of `TARGET_REPO_OWNER`, `TARGET_REPO_NAME`, `TARGET_BRANCH`, or `GH_PAT` missing or empty causes the workflow to fail with an explicit, named error before any network call is made. Verified by a dry-run / unit test of the workflow's preflight step.
4. **Public regression.** The byte-level hash of every file currently emitted by `npm run build:static` is unchanged by this feature, given an unchanged `articles/` and `data/catalog.json`. Verified by running `build:static` on a snapshot of the repo before and after the change and diffing the output trees.
5. **Documentation and tracking.** `CLAUDE.md`, `README.md`, `docs/design/project-design.md`, `docs/design/project-functions.md`, `docs/design/configuration-guide.md`, and `Issues - Pending Items.md` all reflect the new flow, the new CLI/workflow, the new configuration parameters (including PAT expiration handling), and the privacy trade-off.
6. **PAT expiration warning.** With a `GH_PAT_EXPIRES_AT` value within the configured warning window, the workflow emits a visible warning in its log output. With a value outside the window, no warning is emitted.

## Assumptions

- **A1. Privacy trade-off accepted.** The user explicitly accepts that the experimental site is publicly reachable to anyone who knows or discovers its URL. There is NO authentication, NO IP restriction, NO secret token. The "private" property is solely the absence of inbound links and the use of an unadvertised repo. *(Basis: explicit decision #5 in the raw request.)*
- **A2. Target repo will exist before first run.** The user will create the target GitHub repository and enable Pages on its `gh-pages` branch before the GitHub Action is run for real. *(Basis: explicit decision #3.)*
- **A3. Same byte-identity contract applies.** The existing `articles/` byte-identity invariant transfers verbatim to `experimental/`. *(Basis: explicit decision #6.)*
- **A4. PAT is fine-grained and scoped to the target repo only.** The PAT will be a fine-grained Personal Access Token with `contents:write` on the single target repo, minimizing blast radius. *(Basis: principle of least privilege; user can override in Open Question 5.)*
- **A5. Single target repo for v1.** Only one target repo is supported in the first iteration. Multi-target publishing is a future follow-up. *(Basis: raw request describes "another repo" in the singular.)*
- **A6. Public catalog page is the authoritative public surface.** The exclusion test treats `data/catalog.json` (and any sitemap derived from it) as the authoritative listing of public content; if experimental content does not appear there, it is considered excluded from the public surface. *(Basis: existing project conventions.)*

## Open Questions

These MUST be resolved by the user before the planner produces `plan-NNN-experimental-sibling-publish.md`:

1. **Target repo identity.** What are the exact `owner` and `name` of the target GitHub repository (or repository naming convention) the user intends to create?
2. **Site shape.** Should the experimental site expose its own catalog/index page (parallel to the main site's catalog), or should it be a flat collection of standalone HTML files reachable only via direct URL (e.g. `/a/<slug>`) with no listing page at all? The "private" intent leans toward the latter, but the user should confirm.
3. **Authoring CLI shape.** Should the existing `publish-article` CLI gain an opt-in `--experimental` flag, OR should a brand-new `publish-experimental-article` CLI be scaffolded via `/tool-conventions scaffold`? Trade-off: flag = less surface duplication; separate CLI = stronger isolation and matches "single writer per target" pattern.
4. **Workflow trigger.** Should the cross-repo publish GitHub Action run (a) on every push to `main`, (b) only when files under `experimental/` or `data/experimental-catalog.json` change, (c) on a manual `workflow_dispatch` only, or (d) some combination (e.g., `workflow_dispatch` + path-filtered `push`)?
5. **PAT scope and rotation policy.** Fine-grained PAT vs. classic PAT; required scopes (`contents:write` is the minimum for a fine-grained token); rotation cadence; concrete expiration date to populate `GH_PAT_EXPIRES_AT`; and warning threshold (default proposed: 14 days).
6. **Entry-point index page.** Should there be ANY index/landing page on the experimental Pages site (even a minimal one listing nothing), or should the root path return 404 / GitHub's default, with every piece of content reachable only by direct slug?

## Original Request

> "Can I have a folder in this repo where I collect the YouTube deep-dives and articles that I want to be published to the GitHub Pages of another repo, so that they are visible only to those who visit that repo?"

Locked-in decisions provided alongside the raw request:

1. New top-level folder — `experimental/` (NOT `private/`, NOT under `articles/`). Holds byte-identical HTML files, same contract as the current `articles/` flow.
2. Content type — same as current articles: standalone HTML files. (No new content type; YouTube deep-dives are already authored as standalone HTML via the existing flow.)
3. Target repo — a SEPARATE GitHub repository that does NOT yet exist. The user will create it manually. Target repo name is a configuration parameter; never hard-coded.
4. Publish flow — a GitHub Action in `agent-news` that builds the experimental site and pushes the artifacts to the target repo's `gh-pages` branch using a PAT stored as a repo secret. No local CLI required for cross-repo publish (the existing `publish-article` CLI is still used locally to add files to `experimental/`).
5. "Private" semantics — the experimental content must NOT be included in the main agent-news GitHub Pages site (excluded from `build:static`, public catalog, sitemaps). Privacy is achieved purely by living on a different, unadvertised Pages URL — there is NO authentication and NO access control. User accepts this trade-off.
6. Byte-identity invariant — the experimental HTML files, once built and pushed, must reach the browser byte-identical to the source files in `experimental/`, exactly like the existing articles flow.
