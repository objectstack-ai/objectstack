---
'@objectstack/spec': patch
---

fix(spec): the published bundles' text equals the source again — the build marks pure calls only, never a string (#20686)

The build annotates each call of `lazySchema`, `strictObject` and `defineForm` as pure so a consumer's bundler can drop the schemas it never reaches. The rule that placed those annotations also rewrote a marked name quoted inside a string, so one D3 migration entry of protocol 18 (`dashboard-widget-stage-order-non-funnel-refused`) shipped a build-time comment marker inside its `acceptanceCriteria` text in `@objectstack/spec/migrations`, where its source reads `` `z.strictObject(DashboardWidgetSchema.shape)` ``. `os migrate meta` prints that text as the entry's `verify:` line when protocol 18 is the migration target. The published value now equals the source, character for character.

The annotations now come from the TypeScript parse of each file, so a marked name inside a string, template text, a comment or a declaration is never touched. Every call that carried an annotation still carries one, and the published code is otherwise unchanged. One call, `z.strictObject(…)` in the Turso driver config schema, now has its annotation in front of the call rather than after the `z.`, where esbuild had been dropping it. Measured with esbuild, a consumer that imports one schema from `@objectstack/spec/data` or `defineStack` from the root gets a bundle of the same size as before.

Clause-②: no
