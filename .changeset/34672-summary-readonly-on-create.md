---
'@objectstack/objectql': patch
---

fix(objectql)!: a roll-up `summary` field is read-only on create too, and a create seeds it as for an empty child list

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed, and nothing stored is rewritten: the moved answer is whether a non-system create may store a caller's starting value in a roll-up summary column. The one-line fix is in the body: leave the summary field out of the create payload, or write it from server code with isSystem: true. -->

**BREAKING** for a caller that sets a starting value on a `summary` field. A REST `POST /api/v1/data/:object` (and the batch, `createMany` and composite create doors), an import with `writeMode: 'insert'`, the rows an import with `writeMode: 'upsert'` creates, an MCP `create_record`, a flow `create_record` that does not run as system, and the `insert`-mode preview (`validate`) now drop a value sent for a roll-up summary field, as the update side already does. The rest of the row is stored, and `droppedFields` / `onFieldsDropped` (an import row's `droppedFields`) name the field with reason `readonly`. The column starts as if no value had been sent: `0` for `count` and `sum`, empty for `min`, `max` and `avg`; the next child write replaces it with the computed value. Under `strictReadonlyWrites` the whole create is refused with `ERR_READONLY_FIELD_REJECTED` and nothing is written. Before this change the typed value was stored and read downstream (defaults, rules, reports) until the next child write recomputed the roll-up.

Migration for REST, import and MCP clients that set a starting roll-up value: that value is now dropped and reported in `droppedFields`; leave the summary field out of the create payload and let the child rows compute it. Server code that must load a pre-computed total (seed data, a package install, a historical import with `treatAsHistorical: true`, a repair job) writes as the system principal, `{ context: { isSystem: true } }`, which keeps the value, as it keeps every read-only value it sends.

Also fixed: a create that sent a value for a roll-up declared `readonly: true` stored `null` in the column, not the empty-child-list `0`, while the write still succeeded. The value is still dropped and reported, and the column now starts at `0` (`count` / `sum`).

Not changed: seed loads, package installs, historical imports, the roll-up recompute, the backfill and the enable refresh write as before. An in-process create that passes `preserveAudit` without `isSystem` gets no exemption, as for every other read-only column on create. Objects in the `sys_` namespace and the platform-internal `managedBy` buckets stay outside the create-side strip.
