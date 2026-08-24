---
'@objectstack/spec': patch
---

Gate the shipped `llms.txt` against the real package, and repair the claims that had rotted.

`packages/spec/llms.txt` ships in the npm tarball as context for AI consumers and is
hand-kept with no generator, so nothing ever re-derived what it asserts. It had drifted
badly: eleven advertised symbols existed in no entry point (`IUIService` — removed in
v11 — plus `ThemeSchema`, `IdentitySchema`, `PolicySchema`, `ContractSchema`,
`EndpointSchema`, `RAGPipelineSchema`, `MCPSchema`, `FilterSchema`, `AnalyticsSchema`,
`FormSchema`), two advertised packages did not exist (`@objectstack/nextjs`,
`@objectstack/nestjs`), the schema-inventory heading disagreed with the sum of its own
table (171 vs 170) and with the tree (207), and the package heading claimed 19 against a
real 68. An agent reading the file wrote imports that do not resolve.

New gate `check:llms-txt` re-derives every checkable claim on every PR: advertised
symbols against the checked-in `api-surface/` shards, `@objectstack/spec/x` subpaths
against the manifest `exports`, the per-domain schema counts against
`src/<domain>/**/*.zod.ts`, and the package table against the workspace. Symbol claims
are resolved at the strictness their position earns — namespace bullets and fenced
imports name an entry point and must resolve from it, while the architecture overview
resolves against the union. Prose, code-fence bodies and `N+` lower-bound figures are
out of population and the script header says why.

There is deliberately no `gen:llms-txt`: the numbers are not the claim, the prose beside
them is, and restamping a count without re-reading its row would turn a loud staleness
into a silent lie.
