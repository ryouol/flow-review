# Release verification

Recorded October 12, 2026. This is a prototype release for local human review of multi-file TypeScript PRs.

## Final local check

Environment: macOS arm64, Node 22.23.2, Git 2.52.0, pinned npm lockfile.

`npm run check` passed on the final product source:

- TypeScript checking and production build passed.
- 67 backend tests passed, with zero failures, skips, or cancellations.
- 18 Chromium interaction tests passed, with zero retries.
- The illustrative offline demo generated successfully.
- The final live PR-URL command fetched Zod #6587 through authenticated GitHub CLI and produced 5 changed files and 9 original hunks; its temporary cache was cleaned up.
- `npm audit` reported zero advisories across production and development dependencies at this checkpoint.

Coverage includes direct-call provenance, exact original Git hunks and line ownership, changed versus untouched callers, uncertain contracts, LF/Unicode source locations, hostile imports/source strings, CSP executable hashing, binary/rename/delete/mode/symlink/gitlink changes, repository diff programs, replacement objects, local promisor-fetch refusal, offline disk opening, snapshot persistence, and mobile overflow.

The checks exercise behavior within these cases. They are not a proof of correctness for arbitrary repositories.

## Real PR checks and design review

[Six pinned PRs](REAL-PR-VALIDATION.md) provide independent native-Git inventory/hunk comparisons, edit-accounting checks, source provenance checks, and browser checks. The accompanying JSON records exact pins and final source/build fingerprints. The optional [replay runner](../scripts/validate-real-prs.mjs) consumes already fetched local repositories without running their code.

[Claude participated in two review rounds](CLAUDE-COLLABORATION.md). Its implementation critique was based on a description and test evidence, not a source-code audit. Findings and remaining limitations are recorded in the decision log.

## GitHub and next evaluation

The source repository is [ryouol/flow-review](https://github.com/ryouol/flow-review), private. [GitHub Actions](https://github.com/ryouol/flow-review/actions) runs the same full check and exercises the included composite action. Its run status is the authority for remote execution; local results above do not stand in for it.

Suggested next evaluation: Roy reviews one function-heavy PR and one callback/method-heavy PR, explains the behavior change, and compares omissions and effort with his usual GitHub workflow. Faster review, improved comprehension, defect detection, and commercial demand remain unmeasured. No public deployment or live billing is enabled.
