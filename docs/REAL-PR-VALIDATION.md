# Real PR validation

Flow Review was run against pinned, merged public TypeScript PRs. These checks validate acquisition, edit accounting, a subset of source navigation, and automated offline reader interactions. They do not establish faster reviews or better defect detection. The machine-readable record is [real-pr-validation.json](real-pr-validation.json).

## Selection and results

The initial three Hono/Zod cases were purposively selected modest behavior changes. To avoid evaluating only favorable connected examples, the extension uses a fixed rule: the latest merged PR touching at least five non-declaration TS/TSX files in each of Excalidraw, Nest, and TanStack Query. A recent-list seed is expanded to all PRs merged since its date and sorted by merge timestamp; newer nonqualifying candidates and window sizes are retained in JSON. No sample was changed after seeing analyzer output.

Times are single local analyzer runs, excluding cloning, fetching, HTML generation, and browser rendering. They are not benchmarks. Call counts cover calls originating in changed units across both snapshots. Peek share is resolved calls divided by that count; it measures available static declaration links, not comprehension or runtime coverage.

| PR | Files | Hunks | Added / deleted lines | Analyze time | Resolved / unresolved calls | Peek share |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| [honojs/hono #5547](https://github.com/honojs/hono/pull/5547) | 5 | 14 | 63 / 16 | 3128 ms | 2 / 2411 | 0.1% |
| [honojs/hono #5536](https://github.com/honojs/hono/pull/5536) | 3 | 8 | 113 / 29 | 2303 ms | 0 / 13 | 0.0% |
| [colinhacks/zod #6587](https://github.com/colinhacks/zod/pull/6587) | 5 | 9 | 110 / 16 | 4235 ms | 55 / 126 | 30.4% |
| [excalidraw/excalidraw #12260](https://github.com/excalidraw/excalidraw/pull/12260) | 9 | 30 | 477 / 498 | 9638 ms | 320 / 473 | 40.4% |
| [nestjs/nest #18064](https://github.com/nestjs/nest/pull/18064) | 76 | 223 | 243 / 155 | 7990 ms | 35 / 100 | 25.9% |
| [TanStack/query #11711](https://github.com/TanStack/query/pull/11711) | 14 | 28 | 74 / 50 | 6955 ms | 2 / 2 | 50.0% |

## Connected changed declarations

Components use the induced graph of changed function/method declarations with resolved call edges from both snapshots. Direction is ignored, repeated edges are deduplicated, self-loops excluded, and isolated declarations retained. Links through unchanged intermediaries and unsupported runtime targets are outside this metric. A disconnected result is a product boundary, not evidence that changes are behaviorally unrelated.

| PR | Changed declarations | Edges | Components with >1 declaration | Isolated declarations | All component sizes |
| --- | ---: | ---: | ---: | ---: | --- |
| honojs/hono #5547 | 4 | 0 | 0 | 4 | 1, 1, 1, 1 |
| honojs/hono #5536 | 3 | 0 | 0 | 3 | 1, 1, 1 |
| colinhacks/zod #6587 | 5 | 1 | 1 | 3 | 2, 1, 1, 1 |
| excalidraw/excalidraw #12260 | 14 | 9 | 1 | 5 | 9, 1, 1, 1, 1, 1 |
| nestjs/nest #18064 | 11 | 10 | 1 | 0 | 11 |
| TanStack/query #11711 | 1 | 0 | 0 | 1 | 1 |

## Source shape and review ownership

These figures describe where changed lines are assigned for explicit review. File-context ownership includes callback-only tests, imports, types, and edits outside supported declarations; every line is still in the ledger. Unknown contracts are flagged type-checker observations with unavailable types, not verified return guarantees.

| PR | Edited lines owned by functions/methods | Edited lines owned by file context | Head declaration contracts | Unknown head contracts |
| --- | ---: | ---: | ---: | ---: |
| honojs/hono #5547 | 29 | 50 | 4 | 0 |
| honojs/hono #5536 | 22 | 120 | 3 | 2 |
| colinhacks/zod #6587 | 27 | 99 | 5 | 1 |
| excalidraw/excalidraw #12260 | 653 | 322 | 11 | 5 |
| nestjs/nest #18064 | 28 | 370 | 11 | 11 |
| TanStack/query #11711 | 2 | 122 | 1 | 0 |

## Independent checks

For every successful analysis, Git file lists, per-file added/deleted counts, and three-line-context hunk coordinates were compared with independent Git commands. The exact edit census was compared with Git's total changed-line count, with unique edit IDs and valid changed-unit owners checked. GitHub base/head/merge commit and the actual merge base are pinned; the before source uses merge-base, not the later base branch tip.

Every resolved call from a changed unit was checked against its pinned Git object: 414 caller expressions and target text/ranges were checked. This establishes source provenance, not runtime dispatch correctness. Representative source links inspected include Zod's old `mayOutputUndefined` calls at before lines 1275/1304, replacement `mayOmitUndefined` calls on the after side, its added wrapper calling the existing helper at after line 1468, and cross-file `util.prefixIssues`.

All six final generated HTML readers passed rendered startup, raw-hunk/file-ledger checks, and cross-report JSON import in Chromium with no page errors or external requests. Artifact hashes are recorded in JSON. The Zod CLI-generated HTML opened offline in Chromium. Both added and removed callees expanded beside the caller, all three `compile.ts` raw hunks were reachable, and the full before snapshot exposed 2,300 lines. Both initial Hono readers also exposed their selected declarations and full file ledgers. Browser checks recorded no page errors or external requests. These are automated interaction checks, not human usability results.

## Refusals and failures

No analyzer refusals or crashes were observed in the recorded run.

The native Git ledger fix now preserves original hunk coordinates and every exact path/side/line/text edit across all recorded cases. Earlier recomputed diffs understated Excalidraw by two changed lines and aligned a Hono added blank line differently.

A real Hono repeated-call defect was found and fixed: inserting repeated calls early in a long function previously labeled later unchanged calls as added. The real after line 1243 call now remains retained; all 27 added call starts from changed units fall on inserted lines. Multiline calls can legitimately start on unchanged lines, so that observation is specific to the checked case.

## Product limits

- Runtime methods, dynamic properties, property-initialized arrow functions, and callback-only tests limit static navigation. Their source changes remain in the file ledger.
- Hono's body-cache PR has no supported resolved calls from changed units, so it is primarily a raw-diff reading workflow. Large shared test functions can contain thousands of unresolved calls.
- Whole-repository unresolved totals include both snapshots; they are not change-specific defect counts.
- Extended TypeScript configuration is not loaded. Diagnostics disclose inherited alias uncertainty. External dependencies and standard-library types are not loaded; inferred contracts are incomplete type-checker observations.
- Non-UTF8 filename bytes are explicitly refused rather than misdecoded. UTF8source BOMs are retained. The separate adversarial suite covers these release edge cases.
- This sample does not prove all acquisition formats. Rename, binary, mode-only, symlink, deleted-file, hostile-path, and hostile-source cases require the separate adversarial suite.

## Reproduce

After fetching the pinned clones and building, run `node scripts/validate-real-prs.mjs` with Node.js 22 or newer. It performs no network requests and runs no reviewed repository code. Optional arguments are the clone directory and output directory; defaults are `tmp/real-pr-validation` and ignored `tmp/real-pr-replay`. It emits a fresh validation record and offline readers, and returns a nonzero exit status on failures/refusals. The runner is scoped to these recorded text-change examples; the adversarial suite handles binary/rename and hostile cases.

Install Flow Review's pinned dependencies and build it. Clone the official HTTPS repositories into ignored `tmp/real-pr-validation/<repository-name>` directories using `GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null git -c core.hooksPath=/dev/null clone <official-url> <directory>`. Fetch each selected head using `git -c core.hooksPath=/dev/null -C <directory> fetch origin refs/pull/<number>/head:refs/remotes/origin/pr-<number>`. Do not install or run dependencies or scripts from reviewed repositories. Official URLs and all pins appear in the JSON record.

### honojs/hono #5547

- GitHub base ref: `0f5ad7b6bf0c5973a1bcad2b954ede5cc7e224a2`
- PR head: `21a688538606cdc6ccf9901ae8a531368bfe79a5`
- Actual merge base: `6465a911be840036bedb437d043ffb23faf37a3d`
- Merge commit: `b0d28c42987c0c8a4e3c99cdbbbb57450e06dfda`

```sh
node dist/cli.js analyze --repo tmp/real-pr-validation/hono --base 0f5ad7b6bf0c5973a1bcad2b954ede5cc7e224a2 --head 21a688538606cdc6ccf9901ae8a531368bfe79a5 --out tmp/real-pr-validation/hono-5547.reader.html
```

### honojs/hono #5536

- GitHub base ref: `cc92a59f60caf7fe4f61cd01d0d6afb66426c6ae`
- PR head: `f7d4c67c5b887396b04dd7c09d41855eb0e772fa`
- Actual merge base: `cc92a59f60caf7fe4f61cd01d0d6afb66426c6ae`
- Merge commit: `5c292393f21e1693b54a6081491e4e83215d02ea`

```sh
node dist/cli.js analyze --repo tmp/real-pr-validation/hono --base cc92a59f60caf7fe4f61cd01d0d6afb66426c6ae --head f7d4c67c5b887396b04dd7c09d41855eb0e772fa --out tmp/real-pr-validation/hono-5536.reader.html
```

### colinhacks/zod #6587

- GitHub base ref: `0c483c58849fdb6445aea4f54b1bac6b57ab3d22`
- PR head: `557e24b6c89030e8046cae080262348317ee0aff`
- Actual merge base: `a00c3f348abb8b56ccb6281ac4c946141e2728d5`
- Merge commit: `9446b5cc14c5bf137790f1f66abf602044871223`

```sh
node dist/cli.js analyze --repo tmp/real-pr-validation/zod --base 0c483c58849fdb6445aea4f54b1bac6b57ab3d22 --head 557e24b6c89030e8046cae080262348317ee0aff --out tmp/real-pr-validation/zod-6587.reader.html
```

### excalidraw/excalidraw #12260

- GitHub base ref: `e65eca999e071503efb893d3379a29fb96ff37c4`
- PR head: `c43d3a45f444ef906186a7bb3416bfcd20dcff03`
- Actual merge base: `e65eca999e071503efb893d3379a29fb96ff37c4`
- Merge commit: `ef53e5417b2df6b2b8663e385bb8b9a39fea8428`

```sh
node dist/cli.js analyze --repo tmp/real-pr-validation/excalidraw --base e65eca999e071503efb893d3379a29fb96ff37c4 --head c43d3a45f444ef906186a7bb3416bfcd20dcff03 --out tmp/real-pr-validation/excalidraw-12260.reader.html
```

### nestjs/nest #18064

- GitHub base ref: `0498c13a63239fdef2d964acee67b57a22f87c65`
- PR head: `1ebb4191567f12a3004a7d6fe6206d1a690a8d8c`
- Actual merge base: `0498c13a63239fdef2d964acee67b57a22f87c65`
- Merge commit: `2731c18054fb348779311d81e4e20949e313be78`

```sh
node dist/cli.js analyze --repo tmp/real-pr-validation/nest --base 0498c13a63239fdef2d964acee67b57a22f87c65 --head 1ebb4191567f12a3004a7d6fe6206d1a690a8d8c --out tmp/real-pr-validation/nest-18064.reader.html
```

### TanStack/query #11711

- GitHub base ref: `3ae9fb0c3c9145ae9335082299719d6bb0d39137`
- PR head: `acb6e4adc21f9cace58c542c62e42aeb92a0ae58`
- Actual merge base: `3ae9fb0c3c9145ae9335082299719d6bb0d39137`
- Merge commit: `a94c7caeec624d0714ee00be3a703943ec2ddbeb`

```sh
node dist/cli.js analyze --repo tmp/real-pr-validation/query --base 3ae9fb0c3c9145ae9335082299719d6bb0d39137 --head acb6e4adc21f9cace58c542c62e42aeb92a0ae58 --out tmp/real-pr-validation/query-11711.reader.html
```

For each case, independently run `git merge-base <base> <head>`, then compare `git diff --name-status`, `git diff --numstat`, and `git diff --unified=3` from merge base to head. Read caller/target source via `git show <sha>:<path>`. See JSON for precise metrics, failures, environment, and analyzed implementation hashes.
