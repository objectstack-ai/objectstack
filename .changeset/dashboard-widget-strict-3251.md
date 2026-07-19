---
"@objectstack/spec": minor
"@objectstack/lint": patch
---

feat(spec)!: `DashboardWidgetSchema.strict()` — reject undeclared widget keys (framework#3251)

The ADR-0021 analytics endpoint. `DashboardWidgetSchema` now rejects any
undeclared top-level key instead of silently stripping it, moving a whole class
of author error (a hallucinated or legacy key that renders as a silent no-op)
from fallible human review to deterministic CI. `options: z.unknown()` remains
the escape hatch for renderer-specific extras.

A custom error map names the offending key(s) and, when a key is a removed
pre-ADR-0021 inline-analytics key (`object` / `categoryField` / `valueField` /
`aggregate`, pivot `rowField` / `columnField`) or an objectui-internal prop
(`component`, inline `data`), points the author at the dataset shape
(`dataset` + `dimensions` + `values`).

Recorded as protocol-16 migration `step16`
(`dashboard-widget-strict-unknown-keys`), mirroring protocol-15's `step15`
strict flip on the form/page schemas (ADR-0089 D3a). The inline-analytics shape
itself was already removed at protocol 9 (single-form cutover), so there is no
mechanical rewrite — the residue is the strictness, delegated to the author.

**Breaking:** shipped as `minor` per the launch-window policy (a breaking change
does not burn a major while the stack is in lockstep), riding the already-pending
16.0.0 train. The release train's Version-Packages PR must set
`PROTOCOL_VERSION = '16.0.0'`; until then `step16` is inert
(`composeMigrationChain` caps at `PROTOCOL_MAJOR`).

`@objectstack/lint` — the `widget-legacy-analytics-shape` /
`widget-legacy-analytics-unrenderable` rules are retained as the friendly,
suppressible bridge on the raw-config lint/doctor paths (strict preempts them on
the schema-parsed compile/validate paths); doc comment updated to explain the
interplay.
