---
'@objectstack/spec': patch
---

fix(spec): the retired `connector.webhooks` refusal describes declared webhooks as they work now: read from the metadata registry, with no `sys_webhook` row

Clause-②: no
Metadata-protocol: none

An author who writes `webhooks` on a connector is refused, and the refusal tells them to declare the webhook in the stack's top-level `webhooks:` collection. It used to add that such a webhook "is materialized into `sys_webhook`". That is no longer how the platform works (ADR-0131 D2): a declared webhook is read from the metadata registry and delivered on record events, and no `sys_webhook` row is written for it. `sys_webhook` holds only the webhooks an organization authors at runtime. An author following the old text looked for a row that never appears.

The refusal now says this. The same correction is made in the protocol-18 upgrade note for the connector resilience family (its replacement and reason) and in the generated connector reference.

Prose only. The refusal itself, its error code, its path and what the connector schema accepts are unchanged.
