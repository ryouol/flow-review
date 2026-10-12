# Flow Review acceptance requirements

1. Real Git revisions produce a complete file inventory, with merge-base semantics, rename/delete/binary/mode changes, and explicit limits rather than silent truncation.
2. TypeScript calls use actual snapshot declarations with source-side provenance; ambiguous dynamic calls remain unresolved.
3. Reviewer can start from any changed symbol, open changed callees while retaining caller context, navigate old and new links, and return via breadcrumbs.
4. Raw diffs and non-code changes remain reachable. Reading state is per snapshot and canonical unit, and never inferred from merely opening code.
5. Reports are self-contained, run offline, escape hostile source strings, and make no external requests.
6. A CLI accepts real local repositories. Demo covers cross-file flow, removed guard, unchanged wrapper, shared callee, and side changes. Reports can be imported in the reader.
7. Tests include adversarial acquisition/analysis and real browser behavior; the product has been used on real public TypeScript PR snapshots.
8. Claude participates in brainstorming and critiques actual implementation/test evidence; material findings are resolved or documented.
9. Source, reproducible setup, examples, CI, limitations, and verified results are pushed to a private GitHub repository. Verify remote receipt and CI.
10. Human-study or commercial effectiveness claims remain unproven until measured; simulated reviewer checks are not labeled as user research.
