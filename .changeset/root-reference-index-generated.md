---
'@objectstack/spec': patch
---

Generate the root reference index (`content/docs/references/index.mdx`) instead of leaving it ownerless.

That page sat in the AUTO-GEN zone — which the Documentation Guardrails forbid hand-editing —
while `build-docs.ts` never wrote it, so it could only rot, and it had: rows for
`automation/trigger-registry.zod.ts` and `automation/sync.zod.ts` (deleted at #4499 / #4738),
schema names that were never exports (`TriggerRegistrySchema`, `SyncSchema`, `ETLSchema`), a
nine-row section for a `src/hub` directory deleted long ago, a `shared/connector-auth.zod.ts`
row for a file `@objectstack/spec/shared` does not publish, three mutually contradictory totals
(133 / 169 / 19-under-a-heading-of-18), and two dead "Next Steps" cards.

The per-module tables are now enumerated from the same JSON Schema output the category pages are
built from, so a deleted `.zod.ts` cannot leave a row behind, a name the spec does not publish
cannot appear, and every count is a sum of the rows it heads. The page now lists all 1608
published schemas against the 201 files that declare them. `check:docs` covers it like any other
generated file.
