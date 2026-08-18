---
"@objectstack/spec": patch
---

docs(spec): `FlowSchema.successMessage`/`errorMessage` describe themselves as carried on every terminal flow run, not screen-flow-only (#9512)

Since #9414, the pair is set on `AutomationResult` for every terminal run —
`execute()`'s exit, both `retryExecution()` exits, and the resume exit — not
only on `screen`-flow runs. The JSDoc and `describe()` text above
`successMessage`/`errorMessage` in `packages/spec/src/automation/flow.zod.ts`
previously said "Terminal messages for `screen`-flow runs", which stayed the
premise of a route considered and rejected at #9414's triage (narrowing the
contract to screen-flow-only). Text-only: no schema shape, validation, or
`authorable-surface.base.json` change. The two mirrored reference pages
(`content/docs/references/automation/flow.mdx`,
`content/docs/references/api/automation-api.mdx`) are regenerated to match.
