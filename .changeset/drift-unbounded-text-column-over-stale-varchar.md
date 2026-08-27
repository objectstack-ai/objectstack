---
'@objectstack/driver-sql': minor
---

Report an **unbounded** text-family field left on a pre-existing `varchar`
column, instead of leaving the operator with a refused write and no diagnostic

After #11875/#12119 a **newly created** `signature` / `qrcode` column is TEXT and
holds a data URI correctly. `initObjects` is additive-only, so on a database
created by an earlier release nothing is missing, nothing is added, and the old
`varchar(255)` column is kept forever — the boundary #12119's own changeset
states in as many words. What was not stated is what the drift reporter did
about it, and the answer was **nothing**.

The varchar differ's entire branch required `declaredMaxLength !== undefined`, so
on a pre-existing table it split the text family by whether its author had
written a number:

```
Field.signature({ maxLength: 4096 })  over varchar(255)  ->  widen_varchar   reported
Field.signature()      — no bound     over varchar(255)  ->  (nothing)       silent
```

The second row is the common case. Measured on the pre-fix tree, one
`diffManagedTable` call per type on dialect `postgres` against a `varchar(255)`
column: `text` / `textarea` / `html` / `markdown` / `richtext` / `code` /
`signature` / `qrcode` with no `maxLength` each returned **zero** entries, while
`{ type: 'signature', maxLength: 4096 }` over the same column returned exactly
one `widen_varchar` in the same run — so the differ was working and this shape
was simply invisible to it. An upgrading deployment therefore saw no change and
no diagnostic, while the server kept refusing the same write; and the refusal is
a poor substitute for a report, because the live probe behind objectql's
`driver-fault-redaction.ts` measured Postgres's `22001` as identifier-only and
naming the **type** rather than the column (`value too long for type character
varying(255)`).

The divergence is now **detected and reported** under a new report-only
`manual_widen_varchar_to_text` op, naming the declared type, the physical width,
the consequence, and both operator routes. Same `declared ≠ enforced` shape as
the #11374 / #11431 / #11875 family, closed one door further along — at the
migration seam rather than the authoring or write seam.

**Nothing is migrated for you, and nothing new is refused.** There is no
reconciler arm: `os migrate apply` reports the entry as skipped, exactly as it
does for `manual_column_type_change`. The entry is `category: 'needs_confirm'`,
so the artifact-pinned boot gate — which refuses a boot for `destructive` and
nothing else — is unaffected: a deployment that merely refuses over-long values
must not become a crash-loop on its next restart. Dev auto-reconcile takes
`safe` only, so it never applies this unattended either. SQLite is excluded: it
enforces no declared width, so there is no divergence to report.

`manual_widen_varchar_to_text` is a **distinct** op rather than a second use of
`manual_column_type_change`, for a measured reason: `os migrate
multi-value-columns` selects its entire population by
`op.type === 'manual_column_type_change'` and recovers the dialect by matching
the message against `manualJsonConversionSql`, so sharing the op would hand this
finding to a command whose remedy makes the column `json` — and, the message
carrying no json statement, have it refused as `remedy_not_recognized` on every
run.

Graded `minor` rather than `patch` on two counts, matching the sibling drift-op
addition that shipped for #11535: `detectManagedDrift` emits a finding on
existing deployments where it previously emitted none (visible in `os migrate
plan`, in `os migrate apply`'s skipped count and in the boot-time
`[schema-drift]` warn), and the exported `DriftOp` union gains a member, which is
additive for producers but widens a type any consumer switching exhaustively
over it must account for. Nothing is removed, renamed or newly rejected, so it is
not a breaking change.
