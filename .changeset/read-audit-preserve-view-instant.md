---
'@objectstack/plugin-audit': patch
---

fix(plugin-audit): record-view rows keep the VIEW instant instead of the buffer-drain instant (#16829)

`sys_audit_log`'s `record_views` rows answer "when did this user look at this record?". Read auditing batches its INSERTs off the request path by design, so `buildRow` writes `created_at: event.viewedAt` rather than letting the column's `NOW()` default stamp a whole batch with one flush timestamp — up to `flushIntervalMs` after the fact, with read order inside the window destroyed.

`persistReadAuditRows` wrote that row under `{ context: { isSystem: true } }`, and the module's comment cited that flag as what carried the view instant through. It never was. `isSystem` exempts a write from the readonly strip; the layer that decides `created_at` on an insert is the audit stamp hook `sys_stamp_audit_insert`, which reads `session.preserveAudit` and has never read `isSystem`. What was actually carrying the value was that hook's pre-#15964 line, `record.created_at = record.created_at ?? now` — client-preferred on every insert, with no flag and no privilege required. #15964 closed that accident (maintainer ruling 2026-09-06), and the ordinary branch has stamped `now` since: on this path, the flush instant.

The write now declares both context keys, for two different layers:

```ts
await engine.insert(
  'sys_audit_log',
  rows as any,
  { context: { isSystem: true, preserveAudit: true } } as any,
);
```

`isSystem` still carries the readonly-strip exemption the row needs; `preserveAudit` is the one the stamp hook reads. `preserveAudit` is the ruled historical-import channel (#3493, reaffirmed by #15964's ruling) — the door audit left open for reinstating an original timeline — and a view row's original timeline is the moment of the view, so this use is inside its declared purpose rather than a bypass of it.

**What changes for a deployment.** Only for deployments that opted objects in to record-view auditing (`AuditPlugin`'s `readAudit.objects`). Rows written from now on carry the view instant. ⛔ Rows already written under the flattened behaviour are not repaired by this change: their `created_at` is the drain time of the batch they were in, and the view instant they should have carried was never persisted anywhere else, so it cannot be recovered. Only builds cut from `main` after #15964 are affected — the objectql half has not shipped in a published version.

**No exported symbol, schema, route or config key moves.** The only observable change is that a `created_at` this writer already intended to write now survives.
