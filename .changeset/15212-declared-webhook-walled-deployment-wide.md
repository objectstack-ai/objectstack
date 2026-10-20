---
'@objectstack/plugin-webhooks': minor
---

feat(plugin-webhooks): under `group` and `isolated`, a declared webhook is deployment-wide, as it is under `single`; it receives every organization's events, and each delivery is stamped with its event's organization

Clause-②: yes (widening)

A webhook declared with `defineStack({ webhooks })` belongs to the deployment under every tenancy posture (ADR-0131 D2/D6, the epic's ruling A on the walled shape of a declared webhook).

- **Before.** Under a walled posture (`group` / `isolated`) a declared webhook had no organization, so the dispatcher refused every organization-stamped event it matched. It logged one warning per webhook and delivered nothing.
- **Now.** Switched on, it receives every organization's matching events, as under `single`. Each `sys_http_delivery` row is stamped with its event's organization, so an organization reads only its own deliveries. The switch is unchanged: one deployment-level `sys_metadata_activation` row through `POST /api/v1/security/_activation/webhook/<name>`. Under a wall only the platform operator may flip it; an organization administrator gets `403 PERMISSION_DENIED`.
- **Unchanged.** Webhooks an organization authors as `sys_webhook` rows still receive only their own organization's events.

**If you relied on the old behaviour.** A walled deployment that declared a webhook it did not want delivered across organizations should switch it off: `POST /api/v1/security/_activation/webhook/<name>` with `{ "enabled": false }`, as the platform operator.
