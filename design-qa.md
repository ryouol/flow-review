# Production reader visual QA

Source visual truth: `docs/design/concepts/01-focused-review-desk.png`, selected option 1.
Implementation: generated static reader at `http://127.0.0.1:4173/` in the Codex in-app browser.

Viewport: 1487 × 1058 CSS pixels. Source and implementation are both 1487 × 1058 image pixels, density 1; no density scaling or browser-chrome crop required. State: illustrative demo, priceOrder, Both, removed before-side validateRegion call open in one bottom peek. Source mock progress is illustrative; actual progress and Git line numbers derive from report data.

## Comparison history

Iteration 1 evidence: `reports/screenshots/production-reader-qa-01.png`, combined with the selected source in `reports/screenshots/production-design-comparison-01.png`. Focused source/implementation comparisons: `production-design-header-01.png`, `production-design-code-01.png`, `production-design-peek-01.png`.

- P2 typography: primary code at 13px and peek at 12px, with operational labels as small as 9–11px, made the implementation harder to scan than the selected design. Increase main code to 14px, peek to 13px and operational labels/controls to at least 12px, retaining the compact frame.
- P2 contrast: secondary control text and details were too faint. Darken muted text while preserving the light palette.

The single navigator, dominant split code surface, flat header, restrained blue active states, and one bottom peek follow the selected design. Data-correct differences are intentional: saveOrder belongs to store.ts, all changed declarations remain discoverable, and original source coordinates and edits replace mock values. Search, explicit demo labeling, provenance and raw-file access are functional additions.

## Fidelity surfaces

Typography: system sans fallback and system monospace preserve offline operation; fonts require a post-fix capture check. Spacing: 52px header, 268px sidebar and one bordered code workspace match the selected composition. Colors: white/light blue-gray surfaces, blue active controls and red/green source changes; muted contrast requires the fix above. Assets: Phosphor library icons, native text wordmark, no decorative raster imagery in the source target; no invented illustrations or custom SVG replacements. Copy: verified report data and concise operational controls; no paid-value or correctness claims.

## Interactions and remaining verification

Manual checks so far: Try demo, removed-call peek, close, explicit mark, Next, and Contract & callers disclosure. In-app browser error/warning logs were empty. Automated 21-browser suite passed before the final typography/navigation corrections. Final desktop/mobile captures and frozen-source checks remain required.

Iteration 1 result: blocked; corrected in later iterations below.

## Iterations 2 and 3: corrections and final comparison

Iteration 2 enlarged main source to 14px, peek to 13px and operational controls to 12px, with secondary text at 11px. Muted text changed to #5f748f. Evidence: `reports/screenshots/production-reader-qa-02.png` and the combined/focused `production-design-*-02.png` comparisons. Mobile evidence: `production-reader-mobile-02.png` and `production-reader-mobile-before.png` at 390 × 844 CSS/image pixels, density 1. Controls wrap while code scrolls within its own pane; the document does not overflow. Persistent footer controls remain within the viewport.

Iteration 3 found a remaining P2 contrast issue: #1674ff gives 4.22:1 for white small button text. Primary blue changed to #096af4 (4.80:1); selected navigation/call text, code strings, edited-line numbers and feedback-state text were darkened. Secondary text #5f748f gives 4.79:1 on white. These are measurements of the cited colors, not a claim of full WCAG certification.

Final post-fix evidence: `reports/screenshots/production-reader-qa-final.png`, opened together with the selected source in `production-design-comparison-final.png`. Focused source/implementation comparisons opened and inspected: `production-design-type-final.png`, `production-design-toolbar-final.png`, `production-design-peek-final.png`. Final responsive evidence: `production-reader-mobile-final.png` at 390 × 844, Before revision. The large in-app-browser capture is softer than the mock; native mobile capture and computed styles confirm the actual 14px code/13px peek/12px controls. Exact font rasterization across platforms is not claimed.

Required fidelity surfaces checked after fixes:

- Fonts/typography: offline system sans and monospace fallbacks, readable sizes, restrained weights and consistent line height. Code retains original whitespace and coordinates. Exact mock typeface identity is unavailable; platform fallback is intentional.
- Spacing/layout: flat 52px header, one 268px desktop navigator, balanced split source and one 240px bottom peek. No nested cards or competing ledger. Mobile controls wrap with 40px touch targets and optional single revision; horizontal code scrolling is contained.
- Colors/tokens: white and pale gray-blue surfaces, darker accessible operational text, restrained blue selection and red/green edit cues. The measured contrast findings above are corrected.
- Assets/icons: coherent Phosphor library icons and native text wordmark. The target contains no photography, illustration or decorative raster asset. No custom SVG artwork, CSS illustration, placeholder avatars or artificial charts were introduced.
- Copy/content: concise operational language, original report data, explicit Demo label, static-resolution boundaries, original Git diff access, and complete/incomplete inventory disclosure. Mock-only paths, counts and snippets are intentionally replaced by verified report data.

Primary interactions checked manually: demo activation, source-side peek, close, explicit mark, Next, contract/caller disclosure, keyboard mobile navigator, and Before/Both selection. Final in-app-browser warning/error logs were empty. Final automated release check: 72 backend and 23 Chromium tests passed, including JSON import without network requests, focus trap, Escape focus restoration, exact changed-line accounting, ambiguous-token fallback, and Back restoring revision plus both scroll coordinates without review credit.

No actionable P0/P1/P2 visual finding remains. P3 follow-up: a future branded typeface can be evaluated without adding network font requests. Human usefulness and willingness to pay remain unmeasured.

Implementation checklist: completed typography, contrast, responsive controls, selected design comparison, focus/navigation regressions, and frozen-source release checks.

final result: passed
