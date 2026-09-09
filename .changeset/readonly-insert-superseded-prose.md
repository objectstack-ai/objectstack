---
"@objectstack/objectql": patch
"@objectstack/rest": patch
---

Documentation only: seven in-source prose sites that still stated the superseded readonly-on-INSERT contract as live now state the ruled one.

The 2026-09-03 maintainer ruling (option C, #14147) put the static `readonly` strip inside `engine.insert` under the same `isSystem` gate as `engine.update`, and deleted the metadata-protocol create-ingress copy. Comments and test headers written before that ruling still said, in the present tense, that a non-system INSERT is exempt from the static strip, or that the strip lives at the DataProtocol create ingress. Each now states the ruled contract, and the superseded sentence is kept only as history, marked as superseded.

No behaviour changes and no test was deleted, skipped or re-scoped — the diff is comments only. It is a `patch` rather than `skip-changeset` because it was measured to publish: `@objectstack/objectql`'s comment edit moves source line numbers, so `dist/{index,core}.{js,mjs}.map` change, and `@objectstack/rest` inlines that same objectql source into its bundle, so `dist/index.{js,cjs}.map` change with it. Every emitted `.js` / `.mjs` / `.cjs` and every `.d.ts` / `.d.mts` / `.d.cts` is byte-identical before and after, and all six maps ship inside the published tarballs.
