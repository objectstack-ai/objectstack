---
"@objectstack/plugin-webhooks": minor
"@objectstack/spec": patch
---

fix(webhooks): materialize stack-declared webhooks into the dispatcher (#3461)

A webhook authored declaratively — `defineStack({ webhooks })` / `defineWebhook()`,
validated against the spec `WebhookSchema` — was a **silent no-op**. The runtime
dispatcher (`AutoEnqueuer`) fans out off `sys_webhook` DATA rows (`object_name` /
`active`), which until now were only ever written by hand through the object's
CRUD UI. Nothing turned a declared webhook (`object` / `isActive`) into a
dispatchable row, so authoring `webhooks:` on a stack produced `webhook` metadata
that never fired (ADR-0078). The showcase app itself shipped a `webhooks:` entry
that did nothing.

`@objectstack/plugin-webhooks` now bridges the two on boot:

- **`bootstrapDeclaredWebhooks`** reads declared `webhook` metadata from the
  ObjectQL registry (where the manifest decomposition already parks
  `stack.webhooks`), validates each through `WebhookSchema.parse()` — the spec
  schema finally has a real consumer — and materializes it into a `sys_webhook`
  row, mapping `object → object_name`, `isActive → active`, and stashing the full
  envelope (headers / secret / retry / timeout) in `definition_json`. The
  auto-enqueuer's first cache refresh then picks the row up and dispatches it.
- **Seed-not-clobber provenance** (mirrors `sys_sharing_rule`, #2909): `sys_webhook`
  gains `managed_by` / `customized` columns. Declared webhooks re-seed every boot
  as `managed_by: 'package'`, but a row an admin created (`managed_by: 'admin'`) or
  edited in Setup (`customized: true`, stamped by a `beforeUpdate` hook) is never
  overwritten — a deactivated noisy webhook survives redeploys.

Connector-declared `webhooks` remain not-yet-enforced (that is a separate seam,
#3197). Registering `webhook` as a first-class metadata type + enrolling it in the
liveness `GOVERNED` set is a tracked follow-up.

Migration: none required. Existing hand-authored `sys_webhook` rows default to
`managed_by: 'admin'` and are never touched by the seeder. Anyone who authored
`webhooks:` on a stack expecting it to fire will find it now does — review those
declarations (especially `url` / `isActive`) before upgrading.
