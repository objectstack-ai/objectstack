---
'@objectstack/driver-sql': minor
---

Report a multi-value field left on a stale `varchar`/`text` column, instead of
letting it silently corrupt every array written to it

A field that gains `multiple: true` materialises as a `json` column on a fresh
database, but `initObjects` is additive-only: on a database created while the
field was single-value, nothing is missing, so nothing is added and the old
`varchar`/`text` column is kept forever. The write path stringifies the array
for a json field on every non-SQLite dialect; the read path relies on the
driver's column-type-based decoding, which a stale textual column defeats. The
array goes in as the literal `["id1","id2"]` and comes back as a **string** —
so a hook copying the value into a child record's single-lookup column writes
that whole string as one id. User-filed production report, repaired by hand on a
live database.

Until now the schema-drift detector said **nothing** about it. Measured on the
pre-fix tree against live Postgres 16.13 and MySQL 8.0.46: after the metadata
change and a reboot, `detectManagedDrift()` returned `[]` and the boot logged
zero `[schema-drift]` lines, while the very next write stored
`["user_A","user_B"]` into a `character varying(255)` column and read it back
with `typeof === 'string'`. The action vocabulary had no "the base type is
wrong" entry at all — only `relax`/`tighten_not_null`, `widen`/`narrow_varchar`,
`drop_column`, `drop_column_default` and the index ops.

The divergence is now **detected and reported**, naming the table, the column,
the declared type, the physical type and the exact statement an operator runs by
hand — dialect-correct, and executed against both live servers by the suite
rather than merely printed. ObjectStack does **not** change the column: an
`ALTER TABLE … TYPE json USING …` over existing rows with an index drop and
rebuild is a destructive migration over shipped data, and whether the platform
should perform it is a separate, open decision. The new `manual_column_type_change`
op deliberately has no reconciler arm; `applyMigrationEntries` reports it as
skipped, which is the intended contract while that decision is open.

Reported at severity `error` and category **`needs_confirm`**, and the category
is load-bearing rather than cosmetic. Every database this finding describes is
already serving — that is the premise of the report — and the artifact-pinned
boot gate refuses a boot for `category === 'destructive'` and nothing else
(`severity` it never reads). Measured both ways: a `destructive` entry returns
`ok=false` from that gate, this entry returns `ok=true`. Spelling it
`destructive` would have turned every affected deployment into a crash-loop on
its next restart — the report of the corruption becoming the outage.

SQLite is deliberately excluded, and the exclusion is a measurement rather than a
scoping convenience: the same stale column reads back as a real `['x','y']`
array there, because SQLite's read path `JSON.parse`s regardless of what the
column calls itself. There is no corruption to report, and reporting it anyway
would put a permanent `error` finding on every long-lived SQLite development
database. A stale `integer`/`timestamp` column is excluded for the mirror-image
reason — the server already refuses that write loudly, so there is no silence to
break.

Also fixed, same defect class: a multi-value field that *also* declared
`maxLength` used to produce `narrow_varchar` at severity `error`, category
**destructive** on both enforcing dialects — a finding that refuses the
artifact-pinned boot and invites `os migrate apply --allow-destructive` to
rewrite the column to `varchar(50)`, the exact opposite of the repair it needs.
`createColumn` returns at its `multiple` branch before `maxLength` is ever read,
so the emitter never asks for that width; the differ no longer does either. The
single-value width branch is untouched and pinned as untouched.
