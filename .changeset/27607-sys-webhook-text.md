---
'@objectstack/plugin-webhooks': patch
---

docs(plugin-webhooks): the `sys_webhook` object says a row is a webhook an organization authors, and that a declared webhook is not a row

Clause-②: no
Metadata-protocol: none

The `sys_webhook` object description shown in Setup and Studio said a webhook declared in code with `defineStack({ webhooks })` / `defineWebhook()` was "materialized into rows on boot". That boot seeder is retired: a declared webhook is read from the metadata registry and writes no `sys_webhook` row. The description now says a row is a subscription authored in the Studio editor or through the API, and that a declared webhook is read from the registry.

The help text of two system fields is corrected the same way. `managed_by`: `package` names a copy the retired 18.0 boot seeder wrote, which nothing writes now, and `platform` is reserved. `customized`: it is read by the ownership ceremony (an edited copy under a declared name is kept as a clone, a pristine one deleted), not by a boot seeder. The English bundle is regenerated, and the zh-CN, ja-JP and es-ES strings for these three texts are re-translated. No behaviour, field or option changes.
