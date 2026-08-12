---
'@objectstack/lint': patch
---

`visibility-root-mislayered` and `visibility-bare-identifier` now explain the metadata-editing layer by naming the **surface** — a schema-bound metadata-editing form, the row under edit — instead of a `*.form.ts` filename.

Since the layer derivation landed (#7815), a form view declaring `data: { provider: 'schema', schemaId }` is judged at the metadata layer at the runtime publish gate. That door's audience is a Studio / REST `/meta` / MCP author who has no `*.form.ts` to open, so the prose justified a correct prescription by pointing at a file the reader cannot reach. The mirror (runtime) arm named `*.view.ts` / `*.page.ts` the same way and is fixed with it.

Prose only: no rule id, severity, prescribed root or firing condition changes, and the actionable half of every message and hint is unchanged. The `*.form.ts` mentions addressed to a **file-aware caller** of `validateVisibilityPredicates` (the `opts.layer` contract) are deliberately kept — there the filename is accurate and is the point.
