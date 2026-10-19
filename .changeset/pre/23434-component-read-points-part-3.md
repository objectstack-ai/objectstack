---
'@objectstack/spec': patch
---

Component-member read points, part 3 of 3, plus the two held-back moves and the other citation spellings: `packages/spec/src` no longer ties a live read point to an objectui commit or to the console pin.

Clause-②: no

- **Component-member tests and the other group-C files.** `component.test.ts`, the `component-*.pin.test.ts` family, the record-block tests, `expression-bindable-text-keys.zod.ts`, `page.zod.ts` and `inline-grid-column-carriers.test.ts` now point at `liveness/page.json`, row `regions`. The evidence list there is the same one parts 1 and 2 carry. `content/docs/references/ui/expression-bindable-text-keys.mdx` is regenerated from the shortened comment.
- **The two held-back moves.** The `measures.format` record in `src/ui/dataset.zod.ts` moves into `liveness/dataset.json`, row `measures.format`. The `enable.apiMethods` record in `api-methods-batch-conformance.test.ts` moves into `liveness/object.json`, row `enable.apiMethods`.
- **Other spellings.** Live read points written as `objectui SHA … File.tsx:NNN`, or sha-less as "at the `.objectui-sha` pin", move into the note of their row in `field.json`, `action.json`, `app.json`, `dashboard.json`, `view.json` or `page.json`, each as `objectui @SHA FILE#SYMBOL`.
- **Unchanged on purpose.** Retirement history stays where it is: the ADR-0087 conversion entries, the v18 migration entries and the retirement pins. A citation with no matching ledger row also stays, and is listed on the pull request.
- No schema, type, export, default, accept or refuse change. No `.describe()` text changed.
