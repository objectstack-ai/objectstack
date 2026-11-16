---
'@objectstack/spec': minor
'@objectstack/plugin-webhooks': minor
---

fix(spec,plugin-webhooks)!: a webhook can no longer be saved with method `GET`, and a stored GET webhook is parked with a visible reason instead of failing silently

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — `git grep` of `skills/` finds no webhook `method` value taught anywhere, so no page names `GET` as a webhook method.

<!-- adr-0087: registered webhook-method-get-retired -->

**BREAKING** for a webhook authored with `method: 'GET'`. Every webhook delivery sends the event envelope as its request body, and a GET request carries none, so no GET webhook ever delivered an event: the outbox sent the body, the HTTP client refused a GET with a body, and the delivery retried until dead. `GET` is removed from both authoring surfaces.

What moves (each line FROM → TO):

- `WebhookSchema.method` (`@objectstack/spec/automation`, a declared webhook in `defineStack({ webhooks })`): FROM `GET` / `POST` / `PUT` / `PATCH` / `DELETE` TO `POST` / `PUT` / `PATCH` / `DELETE` (default `POST`, unchanged). `method: 'GET'` fails parse with a prescription naming the four methods; any other unknown method keeps zod's own message. A declared GET webhook already in a registry is skipped with the existing "declared webhook failed validation — not dispatched" warning.
- the `sys_webhook` `method` select (`@objectstack/plugin-webhooks`, Setup and the data API): FROM five options TO four; an insert or an update with `method: 'get'` FROM stored TO refused 400 `VALIDATION_FAILED`. The `options.get` translation leaves every locale bundle.
- a `sys_webhook` row already stored with `get`: FROM retried until dead on every event (and, from the outbox's bodyless-GET refusal on, a lost-event log line and no delivery row) TO parked — each event it matches is written to `sys_http_delivery` as a `dead` row with 0 attempts, no signature and a reason that names the method and the fix, said once at `error`; nothing is sent and the row cannot be redelivered.

The fix: set the webhook's `method` to the one the endpoint accepts a body on — `POST` (the default), `PUT`, `PATCH` or `DELETE`. The parked row re-arms at the next periodic cache refresh. A receiver that only answers GET cannot take a webhook.

No conversion is made, at load, at save or by a migration (ADR-0087 D3, entry `webhook-method-get-retired`): there is no lossless one, because converting GET to another method would start sending a different request to an endpoint its administrator configured for GET. A stored row's method is left exactly as stored.

Unchanged: a `POST` / `PUT` / `PATCH` / `DELETE` webhook delivers byte-identically; `HEAD` was never a webhook method on either surface.
