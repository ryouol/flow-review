# Release verification

Recorded October 13, 2026. Production v1 is a static online reader plus a local analyzer for human review of TypeScript pull requests.

## Production release

[Open Flow Review](https://flow-review-two.vercel.app). Vercel returned target `production`, state `READY`, deployment `dpl_FWaEweDbiqTTvi8GhFAjrRAx3SBX`, and that production alias. The [release record](production-release.json) contains file hashes and scope. The deployment workflow verifies CLI/API receipts without fetching the published URL.

Only three public files were uploaded: the synthetic-demo reader, its security-header configuration, and the analyzer archive. Vercel project metadata was ignored. Private reports, repositories, Git caches and credentials were excluded. Inherited deployment protection was retained; use the production alias instead of the protected generated deployment URL.

The reader has no hosted PR-analysis API. Report JSON is imported in memory. Source stays in the browser; reading marks and notes remain in that browser origin under the snapshot identifier. The analyzer needs Node 22+, Git 2.52+ and authenticated GitHub CLI for PR links. Offline HTML reports remain supported.

## Final local check

macOS arm64, Node 22.23.2, Git 2.52.0, pinned lockfile. `npm run check` passed on the final source:

- TypeScript checking and production builds passed.
- 72 backend tests passed with no failures, skips or cancellations.
- 23 Chromium interaction tests passed with no retries.
- Offline demo and static-site export generated successfully.
- Isolated analyzer archive ran help and demo outside ancestor dependencies; it contains exactly six regular files plus three directories, no AppleDouble metadata, no dependency install or lifecycle scripts, and all six bundled license notices.
- `npm audit` reported zero advisories at this checkpoint.

Coverage includes source-side links, complete original Git hunks and edit ownership, shared review credit, uncertain contracts, hostile strings, malformed and inconsistent imports, CSP hashing, opaque/rename/mode/delete/symlink/gitlink changes, source controls, Git acquisition boundaries, snapshot persistence and offline opening. New browser regressions verify ambiguous inline tokens use line affordances, keyboard dialogs retain focus, and Back restores revision and both scroll axes without review credit.

These checks cover the recorded cases, not arbitrary repositories.

## Real PR and visual verification

[Six pinned PRs](REAL-PR-VALIDATION.md) passed native Git inventory/hunk comparisons, ownership of 1,844 edits, and 414 source-provenance checks. All six readers passed the new navigator/split/raw-file checks. The hosted blank shell imported all six reports with one initial page request and no source uploads or external requests. The [JSON evidence](real-pr-validation.json) matches final source and asset fingerprints.

[Visual QA](../design-qa.md) passed against selected option 1 after typography, contrast and mobile corrections. Desktop and focused comparisons were inspected together with the source; mobile controls remain within the viewport. Browser error/warning logs were empty. The large in-app capture is softer than the source mock; actual font sizes were verified and the native mobile capture is readable.

[Claude's three collaboration rounds](CLAUDE-COLLABORATION.md) informed product direction and implementation critique. Claude received descriptions/test evidence rather than a source-code or screenshot audit.

## GitHub and evaluation

The [source repository](https://github.com/ryouol/flow-review) remains private. [GitHub Actions](https://github.com/ryouol/flow-review/actions) runs the full check, exercises the composite action and uploads demo/production artifacts. Its run status is the authority for remote execution; the local results above do not substitute for it.

Next: observe Roy and other developers reviewing actual PRs, including callback/method-heavy code. Faster review, better comprehension, defect detection and willingness to pay remain unmeasured. No accounts or live billing are enabled in this release.
