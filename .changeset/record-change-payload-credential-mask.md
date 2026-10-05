---
'@objectstack/objectql': patch
'@objectstack/plugin-approvals': patch
'@objectstack/plugin-webhooks': patch
'@objectstack/service-knowledge': minor
---

Record-change payloads apply the same credential mask and internal-field omission as write responses.

Clause-②: yes (widening)

- **`data.record.created` / `data.record.updated` events.** The engine projects the event's `after` and `changes` bodies through `omitInternalFieldsFromWriteResponse` (`@objectstack/core`), the helper every external write response already uses: credential-class fields (`secret`, and `password` outside the exempt `managedBy` buckets) carry `SECRET_MASK` (or `null` when unset), and `internal: true` fields are omitted. The engine's own write result is unchanged, so a privileged in-process caller that reads the stored value back off `insert` / `update` still sees it.
- **Approval request snapshot.** The record snapshot an approval request stores (`payload_json`) applies the same rule when the request is opened.
- **Outbound webhook body.** The delivered body, and the delivery row that stores it, apply the same rule to `before`, `after` and `changes`.
- **Knowledge index documents.** `recordToDocument` takes the object definition as an optional fourth argument and skips credential-class and `internal` fields, under `'*'` and when a source names one explicitly. `KnowledgeService` passes the definition from the bound engine.
- **New public surface of `@objectstack/service-knowledge` (additive):** `recordToDocument` accepts the object definition as an optional fourth argument; existing three-argument calls behave as before.
- **Receivers see masked values.** Webhook receivers and realtime clients now get `SECRET_MASK` (or `null` when unset) for credential-class fields and no key for `internal` fields.
- **Existing rows are not rewritten.** Approval snapshots, webhook delivery rows and knowledge documents written before this change keep their stored bodies; reindexing a knowledge source refreshes its documents.
- The audit trail already masked these fields and is unchanged. No other accept set or public schema changes.
