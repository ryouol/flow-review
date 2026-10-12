# Flow Review

Read a TypeScript pull request by following the changed logic across files. Keep a caller visible while opening the before/after code of a function it calls, and keep every remaining file in a separate review ledger.

Flow Review is a local CLI and a self-contained browser report. It needs no LLM, API key, hosted service, or repository upload. The GitHub PR command fetches source to your machine; the generated reader itself works offline.

## Try the reader

Requires Node.js 22 or newer, npm, and recent Git with `--no-lazy-fetch` support (tested with Git 2.52). GitHub PR URLs additionally require the [GitHub CLI](https://cli.github.com/) signed in to an account with repository access.

```sh
npm ci
npm run build
npm run demo
open reports/demo.html
```

On Windows/Linux, open `reports/demo.html` with your browser or file manager. The demo is illustrative checkout-service code, not a real employer PR or a measured user-study result.

Analyze a real PR URL:

```sh
node dist/cli.js pr --url https://github.com/colinhacks/zod/pull/6587 --out reports/zod-6587.html
```

Or use an existing local checkout:

```sh
node dist/cli.js analyze --repo /path/to/repository --base origin/main --head HEAD --out reports/review.html
```

The comparison is `merge-base(base, head)..head`. Source comes from committed Git objects. Working-tree edits do not enter the report; tracked local changes are disclosed. The PR command pins the fetched API base/head commits and uses a temporary bare repository, then cleans up its own temporary cache.

Every command writes `.html` and matching `.json` files. Open the HTML directly, or import the JSON into an already open reader. Reading marks and notes stay in browser storage under the snapshot identifier. The reader still opens when storage is unavailable, but persistence then does not work. Browser-local notes are not GitHub review comments.

## How to read a change

1. Choose a suggested starting function, search for a changed declaration, or open a file from the complete ledger.
2. Read the before/after diff. Expand a source-linked call to open its declaration beneath the caller. Unchanged wrappers remain available when they connect changed functions.
3. Switch between Before, Both, and After. Removed calls retain their base-side locations and targets.
4. Inspect the contract and callers panel for before/after signatures and resolved incoming callers, including untouched callers. Call-site badges describe edited lines, not a runtime compatibility verdict.
5. Use the nested call breadcrumb to start a new reading path. Recursive paths and depth limits stay explicit.
6. Open original file hunks to inspect edits outside the functions, including configuration, dependencies, deleted files, modes, renamed paths, and binary changes.
7. Explicitly mark a declaration or whole file reviewed. Opening code never marks it reviewed, and shared declarations count once. Export private notes when useful.

Every added or removed line has exactly one review owner. Lines spanning sibling declarations stay in the file residual; nested declarations have their own owners. File metadata is reviewed separately. Next-unreviewed navigation does not give review credit.

Review progress records your explicit marks. It does not prove understanding, test coverage, or correctness.

## Evidence and limits

The compiler resolves direct calls to ordinary functions and constant function bindings in the acquired TypeScript snapshots. Explicit imported aliases, namespace imports, re-exports, and root configuration path aliases are supported where they resolve to a source declaration. A static declaration link is not a guarantee of a runtime target.

Mutable function bindings, instance-method dispatch, parameters, framework callbacks, computed targets, external dependencies, and declarations without supported bodies remain unresolved. Nested callbacks in framework/test registration are not reconstructed as execution paths. The unresolved repository count includes unchanged code in both snapshots; selected declarations show their own boundaries separately.

Root `tsconfig.json` path options and strict-null-checking settings are loaded and disclosed. Missing settings use strict null checking; extended settings remain unverified. Return contracts involving `any`, `unknown`, or empty object inference are marked uncertain. Extended configs, project references, dependencies, and arbitrary framework behavior are not loaded or executed. Syntax errors remain visible as diagnostics and raw file changes. Function identity is based on path, lexical name, and same-name occurrence; renames/moves can appear as added/deleted declarations rather than a asserted semantic match. Git file renames remain explicit in the ledger.

Call added/removed labels compare relationships, prioritizing unchanged source-line correspondence. A retained relationship can still have changed arguments or branch conditions, so inspect the source diff. Structural badges are reading cues and make no defect verdict.

Every acquired changed file is retained, including binary files and metadata-only changes. Required blobs over 8 MiB or source snapshots over 48 MiB fail explicitly instead of generating a partial success. JSON import has a 30 MiB limit. The navigation does not model every possible behavior.

Reports embed source code. Treat a private report like the underlying repository. The HTML contains no remote assets and makes no external requests; the bundled executable is authorized by a content hash, source strings are encoded and rendered as text, and imported references/coordinates are validated. Invisible source controls are visibly annotated without changing the underlying code. Reviewed repository scripts, hooks, diff drivers, text converters, and symlink targets are not executed or followed. Git replacement objects and local automatic lazy fetching are disabled; multiple merge bases fail explicitly. Only the tool-created PR cache may fetch missing source blobs from its fixed GitHub origin. Arbitrary untrusted report HTML is still executable HTML; generate reports using your trusted local tool.

## GitHub workflow

The included composite action generates an offline report from an already fetched checkout. Upload it as a private workflow artifact; the reviewer downloads and opens the HTML. No deployed website or browser extension is required. See [the integration example](docs/GITHUB.md).

This repository is initially private. Cross-repository use of a private action requires GitHub's repository/action-access configuration; local CLI use works without configuring action sharing. Do not add secrets or private generated reports to Git history.

## Verification

```sh
npx playwright install chromium
npm run check
```

[Release verification](docs/RELEASE-VERIFICATION.md) records the completed checks and their limits.

The check runs TypeScript checking, the production build, backend/adversarial tests, demo generation, and Chromium interaction tests. Tests cover source-side navigation, change accounting, hostile strings, malformed imports, binary/rename/mode/deleted/symlink files, merge-base comparisons, repeated-call insertions, snapshot persistence, offline opening, and mobile layout.

Six pinned real public PRs were independently compared with Git and exercised in the reader: [real PR validation](docs/REAL-PR-VALIDATION.md). Exact pins, counts, method, findings, and limitations are in [the machine-readable record](docs/real-pr-validation.json). These are software and source-provenance checks, not a human-comprehension experiment. Faster reviews and improved defect detection remain hypotheses.

The design follows research on reviewer navigation and existing tools such as CodeRabbit Change Stack, SemanticDiff, and ChangeViz. It does not claim to invent flow-oriented review. [Acceptance requirements](docs/ACCEPTANCE.md) document the product boundary.
