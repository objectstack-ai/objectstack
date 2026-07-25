---
"@objectstack/spec": patch
"@objectstack/cli": patch
---

chore(spec,cli): enroll `webhook` in the liveness GOVERNED set (#3462)

Closes the final third of #3462 (umbrella #1878) — `report` and `dashboard`
landed in #3474; `webhook` was deferred for two reasons, both handled here.

- **Not a registered metadata type.** `webhook` is absent from the metadata-type
  registry, so the gate can't resolve it via `getMetadataTypeSchema`. Registering
  it would switch on Studio webhook CRUD, `saveMetaItem` overlay acceptance, and
  diagnostics sweeping — the wrong move while the authoring surface is still
  disconnected (below). Instead the gate resolves it through a small
  `SPEC_ONLY_SCHEMAS` override in `check-liveness.mts` (consulted before the
  registry): the gate only needs to **walk** the schema, not register it.
- **The whole authoring surface is dead (#3461).** Nothing materializes an
  authored `webhooks:` entry (stack/connector) into a `sys_webhook` dispatcher
  row — the runtime reads only admin-authored `sys_webhook` rows. So
  `packages/spec/liveness/webhook.json` classifies all 16 authorable props
  **dead** and `authentication` **experimental** (HMAC-`secret`-only, its
  existing marker). Per-prop notes record which props a future materializer
  (#3461 option A) could remap (e.g. `object`→`object_name`, `isActive`→`active`)
  vs which have no sink anywhere — doubling as that mapping table.
- **Author-warning wired (`@objectstack/cli`).** Added
  `{ type: 'webhook', key: 'webhooks' }` to `TYPE_COLLECTIONS` in
  `lint-liveness-properties.ts`, so `os compile` now advises authors that
  `webhooks:` is a silent no-op. The required `url` prop carries the single
  warning per webhook (one heads-up per artifact, not one per dead prop);
  `isActive` is left unmarked (default(true) boolean).

This is enrollment only — it does **not** decide #3461's build-the-bridge vs
retire-the-surface question. When that lands, the mapped props flip to live (cite
the materializer) or the ledger is removed with the schema. No spec shape/behavior
change (ledger + gate/lint config only).
