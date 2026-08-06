---
'@objectstack/trigger-record-change': patch
---

record-change trigger: drop the unreachable `input.doc` alias read, seed the flow record from `input.data` only

Behaviour is unchanged: no engine path has ever built `input.doc`, so the alias
limb could not be reached. Every ObjectQL write context spells the payload
`data` — measured and pinned by `hook-input-shape-contract.test.ts` in
`@objectstack/objectql` ("insert carries `data` — never `doc`", #5273). The
branch survived only because the old `HookContext.input` contract table
documented insert as `{ doc, options }`; that table was corrected in #5668, so
the fallback no longer had even a documented producer to defend against, and it
is removed here rather than left as a second de-facto contract (PD #12).
