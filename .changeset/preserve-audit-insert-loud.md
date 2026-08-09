---
"@objectstack/metadata-protocol": patch
"@objectstack/spec": patch
---

`preserveAudit` is an UPDATE-path exemption — the contract now says so, and a non-system INSERT that asks for it is told loudly instead of silently stripped (#6640)

`FieldSchema.readonly`'s `.describe()` promised the opt-in historical-import exemption
(`preserveAudit`, #3493) on **both** write paths, and
`docs/protocol/objectql/security.mdx` agreed. Only UPDATE ever implemented it. The
create-side strip lives at the DataProtocol ingress (`stripReadonlyForInsert`, #3043) and
has never read `preserveAudit` at all — `context.isSystem` is its only exemption — while
the engine's update-side strip consults `isPreservableUnderAudit`.

REST import's `treatAsHistorical` puts `preserveAudit: true` on the write context and
creates through `createData`, i.e. through exactly that ingress. So **one** historical
import kept an author-declared `readonly` business column (`closed_at`, `resolved_by`) on
the rows it UPDATED and silently dropped it from the rows it CREATED. The trigger is not
exotic: the audit family itself is `readonly: true` in the registry's `AUDIT_FIELD_DEFS`,
so an ordinary export→historical-import round-trip carries readonly columns on every row.

Maintainer ruling (2026-08-08), option 2 with a binding loudness rider — the enforcement
is the truth and the contract narrows to it:

- **Contract narrowed.** The `.describe()` text and the security doc now state the
  exemption as UPDATE-path only. The INSERT entry keeps honouring `isSystem` alone;
  replaying archival readonly facts on create requires a system context. Honouring
  `preserveAudit` here instead would have handed a NON-system caller — `treatAsHistorical`
  arrives on an ordinary REST import request — the approval/status columns #3043 exists to
  protect, in one POST.
- **The ignored request stops being silent.** A non-system INSERT that requests
  `preserveAudit` and actually loses fields now logs a `WARN` naming the object, every
  stripped field, the UPDATE-only rule, and the `isSystem` remedy. It fires once per
  ingress call (the union across a batch, as `mergeDroppedFieldEvents` already does), and
  only when something was really removed — an ordinary create that never asked for the
  exemption stays exactly as quiet as #3043 designed it.

**No behaviour change to the strip itself, and no acceptance-surface change** — the
accepted set is byte-identical; only the describe text, the docs, and the new warning are
new.

Warning rather than refusal, measured rather than assumed: `runImport` collects a per-row
write error into a failed row instead of aborting, so refusing at the ingress would not
stop a historical import — it would convert every row it CREATES into a failure while the
rows it updates still succeed. Measured on a throwing variant, the historical import of 2
new rows went from `{created: 2, errors: 0}` to `{created: 0, errors: 2}`. Breaking the
shipped `treatAsHistorical` flow for new rows is the condition under which the ruling names
the loud WARNING — strip still applied — as the containment-correct landing.
