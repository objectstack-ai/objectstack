---
"@objectstack/spec": patch
---

docs(spec): `functional-completeness`'s three `objectql/engine.ts` citations name symbols instead of line numbers (#16960)

The module doc block of `kernel/functional-completeness.ts` cited the runtime that
justifies each rule by line number. All three had rotted: re-measured on `origin/main`
`7ddf13dca` (`engine.ts` is 15,309 lines), the quoted texts live at 8630, 8978 and 921
against cited 3001, 3191 and 346 — drifts of 5,629, 5,787 and 575. Each quoted text
occurs exactly once in `engine.ts`, so those are readings rather than artefacts.

The citations are the only limb tying a rule's justification to the runtime that
implements it, and that limb is walked by a human reading it — nothing in the module can
notice the runtime moved. `:3191` was the dangerous one: the line it names today is
ordinary-looking `dispatch:` code, so a reader following it lands somewhere plausible and
never learns they were sent to the wrong place.

Each now names the enclosing symbol in the repo-root `path#symbol` form
`packages/spec/liveness/field.json` already uses —
`packages/objectql/src/engine.ts#buildSummaryIndex`, `#planFormulaProjection`,
`#expandRelatedRecords` — beside the verbatim snippet. A corrected line number would rot
again on the next refactor; a symbol plus a unique snippet is greppable and survives
movement. The anchor form also moves these three from
`check-spec-docblock-symbol-anchors`' not-judged bucket into resolution (that gate now
reports `3 symbol (3 declaration)` where it reported `0`), so a rename reddens CI.

Doc text only — no schema, export, type or runtime behaviour changes. It ships because
this block is emitted into the published `dist/kernel/index.d.ts`.
