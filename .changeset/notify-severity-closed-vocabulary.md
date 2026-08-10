---
"@objectstack/spec": minor
"@objectstack/service-automation": minor
---

fix(spec): `notify.severity` closes its declared `info | warning | critical` vocabulary at the gate, not only in its describe (#7086)

<!-- adr-0087: not-required (no-migration-prescription) A stored flow is unaffected at LOAD: `FlowNodeSchema.config` is `z.record(z.string(), z.unknown()).optional()`, so `NotifyConfigSchema` runs only at EXECUTE time via `parseNodeConfig` — nothing fails to load or rehydrate, which is the population a D2 conversion exists to protect. And no automatic rewrite is correct here: mapping a stored `'urgent'` to `'info'` would silently pick a severity on the author's behalf, which is precisely the blind-cast defect this change removes. The refusal names the three legal values, so the author reconciles it once and keeps their intent. Re-measured across the monorepo: zero out-of-vocabulary spellings in any flow, example, fixture or seed. -->

`NotifyConfigSchema.severity` was a bare `z.string()` whose `.describe()` read
`'info | warning | critical'` — no "e.g.", no qualifier. In this codebase that
spelling is how a genuine closed vocabulary is documented, so the enumeration
existed only in the sentence. Measured on `origin/main` before the change:

```
severity "info"  -> ACCEPTED    severity "urgent" -> ACCEPTED
severity "warning"  -> ACCEPTED    severity "INFO"   -> ACCEPTED
severity "critical" -> ACCEPTED    severity ""       -> ACCEPTED
```

**Every other surface already declared the set closed**, which is what made the
open gate a defect rather than a design choice: the `notify` executor forwards
the value raw, the messaging dispatcher blind-casts it into the closed union
(`severity: (p.severity as Notification['severity']) ?? 'info'`), and
`sys_inbox_message.severity` is a select field offering exactly these three. So
`severity: 'urgent'` parsed green, published green, and landed in inbox rows
under a TypeScript type that says the value cannot exist — falling through every
downstream `switch` on the three names. An author (very often an AI) who wrote
`Critical` or `urgent` got no diagnostic anywhere on the path.

The gate is now `z.enum(['info', 'warning', 'critical']).optional()`, and the
describe is a sentence about the field, because the vocabulary is carried by the
type — the generated reference renders it as an enum column instead of a bare
`string`. The refusal is self-prescribing:

```
Invalid option: expected one of "info"|"warning"|"critical"
```

**Why closing this gate takes no working authoring shape with it.** The executor
reads `severity` **raw** — it is one of the three keys (`channels`, `topic`,
`severity`) that never pass through `interpolate()` — so a `{record.x}` template
there was forwarded verbatim and never resolved. The schema's module JSDoc
claimed "every string-ish value except `channels`" is interpolated; that was
stale for `topic` and `severity`, and it is corrected here, since it is the
statement the safety of this tightening rests on.

**Blast radius is an execute-time refusal, not a load failure.** `FlowNodeSchema.config`
is an untyped record, so a stored flow carrying `severity: 'urgent'` still loads
and rehydrates exactly as before; the `notify` step refuses when it runs, naming
the three legal values. `''` previously degraded to `info` two layers down and is
now refused at the gate.

The `notify` descriptor's Studio form is closed in the same change
(`enum: ['info', 'warning', 'critical']`). Closing only the Zod would have left
the mirror-image drift the IO-node ledger test exists to prevent — a form
inviting a value the gate refuses at execute time — and the `screen` node's
`mode` is the in-repo precedent for enum-on-both-sides. That ledger test compared
key SETS only, which is the gap this field sat in; it now also reconciles closed
value vocabularies, so the two descriptions cannot drift apart again.
