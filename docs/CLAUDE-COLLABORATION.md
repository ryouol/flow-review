# Claude collaboration decision log

Recorded October 12, 2026. Roy explicitly authorized Claude collaboration for this project.

Conversation: [PR code-review navigation tool](https://claude.ai/chat/a625da78-75f1-47da-bd52-7fc6ea22d08e).

## Receipt and evidence boundary

Native Claude UI showed the initial brainstorming prompt and response as Messages 1–2. On the follow-up check, Message 3 contained the prepared implementation/evidence prompt, Message 4 contained Claude's completed critique, the composer was empty, and the UI stated “Claude finished the response.” Receipt and response were observed. Live streaming was not observed on that check. No messages were sent to other conversations.

Claude reviewed a description of implementation and tests, not a supplied source-code audit. Its suggestions are external critique, not proof of correctness or human-review effectiveness. The follow-up prompt reported 47 backend tests and 12 Chromium tests from an earlier checkpoint; later checkpoints increased coverage. Consult RELEASE-VERIFICATION.md for final totals.

## First round: directions used

- Treat grouping/ordering as established prior art; avoid claiming the basic PR storyline as novel.
- Preserve a complete file inventory independently of the navigation graph, including non-code and deleted-side changes.
- Analyze both revisions from Git objects without executing the reviewed repository or following workspace dependencies into another revision.
- Partition changed lines into canonical owners rather than treating a hunk as a single function's change.
- Add a contract-and-caller view, including inferred return types and untouched callers, with explicit static-analysis limits.

The implementation retained the focused caller/callee reader and flow rail. Claude preferred a linear queue with shallow peeks; this preference was considered but was not treated as an instruction to replace the product. There is no established human-efficacy result favoring either presentation.

## Second round: integrity findings to verify

1. **Line separators:** TypeScript counts Unicode line separators and lone carriage returns as line breaks; Git's hunk coordinates count LF. Derive source citations and edit ownership from an LF-only position table, and test U+2028, U+2029, and lone CR. Validate citations for generated reports.
2. **Shared sibling lines:** Preserve innermost ownership for nested functions, but assign a line spanning sibling declarations to a file residual. Otherwise reviewing one sibling can mark the other's edit as reviewed. Intra-line ownership can remain deferred.
3. **Contract uncertainty:** A return signature affected by omitted external types can be `any` or `unknown`. Do not present that as an established unchanged contract. Disclose inference settings, including strict null checking when it differs from the source project's settings.
4. **Git acquisition boundaries:** Check multiple merge bases, disable external diff and fsmonitor behavior in untrusted repositories, and test a planted custom diff driver. Compare PR-URL inventory with the GitHub PR files API as a second base-selection oracle.
5. **Artifact disclosure:** Check reports, JSON, and diagnostic text for credential-bearing URLs and unintended local absolute paths before sharing.
6. **Visual/source ambiguity:** Expose target provenance, make bidi/lookalike identifiers visible, and ensure oversized recursive syntax fails explicitly rather than silently losing units.

These are findings to resolve or document, not claims that the current product fails each case. The root engineering task owns verification and acceptance decisions.

## Final disposition

- LF-only source locations, sibling-line residual ownership, uncertain contracts, and effective null-checking disclosure are implemented with regression tests.
- Native Git hunks now define exact review rows. Multiple merge bases are rejected; fsmonitor, hooks, external/custom diff programs, text conversion, replacement objects, and local lazy fetching are disabled. Gitlink source, blank context rows, and full inventory remain explicit despite repository diff preferences.
- The generated reader uses a hash-authorized executable, strict report import checks, and visible Unicode-control annotations. Credential-bearing remotes are omitted, and source is acquired from committed blobs without following symlinks.
- A final independent adversarial review found lossy decoding of invalid UTF-8 filenames could silently lose a hunk. The release now rejects those filenames explicitly and preserves source byte-order marks; both cases have regressions.
- The PR URL command pins metadata commits and compares GitHub's file-count metadata with the acquired inventory. A paginated GitHub files-API comparison remains deferred; the six pinned validation cases use an independent native-Git inventory and hunk oracle.
- Changed callers and edited call-site lines are distinct. Next-unreviewed navigation and exact unreviewed-line counters are implemented without automatic review credit.
- Incoming callbacks, dynamic method receivers, arbitrary recursion/large-repository scalability, and homograph detection beyond visible control annotations remain limitations. They are not represented as resolved analysis.

## Second round: usability judgments

- A direct-function census is useful in function-heavy code and weak in method/callback-heavy code. An empty resolved list must not imply there are no consumers.
- Keep changed callers distinct from specifically edited call sites. A caller changed elsewhere does not establish that its invocation was updated for the contract change.
- Consider symbol-reference matching for incoming uses, following aliases, to include callbacks and typed method receivers without guessing runtime dispatch.
- Prefer a small reading queue with an unreviewed-line counter and next-unreviewed navigation. Keep unresolved-call details compact and preserve access to all reasons and source locations.
- A later factual test-expectation view could surface edited expected values, removed assertions, `.skip`/`.only`, snapshot edits, and new mocks. This is deferred; no automated defect verdict was proposed.

## Scope and claims

Continue treating interface/override dispatch, outgoing callback flows, workspace packages without source mappings, external types, intra-line ownership, review-mark transfer across pushes, real target-repository GitHub Actions rollout, and non-TypeScript navigation as explicit limitations or future work. A passing test suite and exact Git agreement demonstrate fidelity within their coverage. They do not demonstrate improved human understanding. A seeded real-PR review with Roy would provide the first exploratory usefulness evidence.
