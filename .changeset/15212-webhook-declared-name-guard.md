---
'@objectstack/plugin-webhooks': minor
---

feat(plugin-webhooks)!: a `sys_webhook` row can no longer take a declared webhook's name — an insert of one, or a rename onto one, is refused with `409 RESOURCE_CONFLICT`

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) A write-door narrowing on one platform table: no spec key, export of the spec, option or stored metadata shape is added, removed or renamed, so `objectstack migrate meta` has nothing to rewrite; rows already stored are never touched, and the remedy is a run-time one, stated below -->

**BREAKING** accept-set narrowing, shipped as `minor` under the launch-window convention for breaking changes (ADR-0131 D6 regime C).

A declared webhook (`defineStack({ webhooks })`) is read-only, and a `sys_webhook` row holding its name withholds the declaration for the whole deployment. Under a walled posture one organization's same-name row would silence the declaration for every organization. So no write may take a declared name, as declared sharing rules already do.

- **Refused now.** A non-system insert into `sys_webhook` whose `name` is declared, switched on or off, and an update that changes `name` onto a declared one. Every door is covered (Setup, the `/data` API, scripts, AI tools): the refusal is `DeclaredWebhookNameConflictError`, `code: 'RESOURCE_CONFLICT'`, `status: 409`, naming the declared webhook.
- **Unchanged.** System writes (the platform's own sweeps and migrations). An update that keeps its name, so the rows an 18.0 install's seeder wrote, and the ones an administrator customised there, stay editable as before. Names nothing declares.

**The remedy.** To change a declared webhook, author your own `sys_webhook` row under another name, and switch the declared one off: `POST /api/v1/security/_activation/webhook/<name>` with `{ "enabled": false }`.
