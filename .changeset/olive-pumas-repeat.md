---
'@objectstack/spec': patch
---

Docs accuracy: correct the `AgentSchema` example and four stale `.strict()` tombstone rationales

`AgentSchema`'s own `@example` wrote `knowledge: { sources: …, indexes: … }`, a key the
same schema declares as `retiredKey()` — so the canonical example an author (very often an
AI, ADR-0033) copies taught a key the schema rejects, and typed `never` fails `tsc` at the
authoring site. The line is dropped; the example keeps `skills`, which is the block's point.

Four tombstone rationales still argued from "the schema is not `.strict()`, so a plain
deletion would silently strip the key". The #4001 `strictObject` conversion made that false
for the schemas named: `AgentSchema` (`agent.tools`), `FieldSchema`
(`field.conditionalRequired`), `ActionSchema` (`action.execute`), and the module docblock of
`shared/retired-key.ts` itself. Each now rests on the reason that is load-bearing today —
the prescription is the payload, since an unknown-key rejection carries neither the
FROM → TO mapping nor the migration command, and the key is typed `never` so the mistake
still fails `tsc` first. Every tombstone stays; only the stated reason changes.

Prose only — no schema shape, acceptance behaviour or `.describe()` semantic is touched.
