---
'@objectstack/plugin-webhooks': minor
'@objectstack/runtime': minor
'@objectstack/spec': patch
---

feat(plugin-webhooks,runtime)!: declared webhooks are read from the registry — the boot seeder retires, no `sys_webhook` row is written for one, and it is switched through the activation ledger

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no spec key, export, option or stored metadata shape is added, removed or renamed, so `objectstack migrate meta` has nothing to rewrite; the rows an 18.0 seeder wrote stay in place and keep working, and what changes is where a declared webhook lives and how it is switched -->

**BREAKING** (a narrowing of where a declared webhook can be edited), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0131 D2 says no seeder writes declared items into a table, and D6 charts behavioural types under regime C. A webhook declared with `defineStack({ webhooks })` now follows both, as declared sharing rules already do: the dispatcher reads the declaration from the metadata registry on every subscription-cache refresh, and `bootstrapDeclaredWebhooks` no longer runs.

What changes:

- **No `sys_webhook` row for a declared webhook.** Before: every boot wrote or refreshed one `managed_by: 'package'` row per declared webhook, shown and editable in Setup → Integrations → Webhooks. Now: a fresh install writes none, and Setup lists only the webhooks an organization authors. The declared webhook still delivers, with the same URL, method, triggers, `timeoutMs`, signing secret and headers; its secret and headers are code, held in memory, and never stored. Its deliveries carry `ref_id = declared:<name>`.
- **A declared webhook is read-only, and switched through the activation ledger.** Before: an administrator edited the seeded row in Setup (`customized: true`). Now: switch it on or off for the deployment with `POST /api/v1/security/_activation/webhook/<name>` and `{ "enabled": true | false }` — one `sys_metadata_activation` row of type `webhook`, which overrides the declared `isActive` in either direction, so a webhook shipped inactive is switched on the same way. The door is the declared-sharing-rule door with `webhook` admitted: `manage_metadata`, then the platform operator under a wall; `404` for a name nothing declares; `503` when no declared-webhook reader is bound or it cannot be read. The dispatcher refreshes in the request that wrote the row. Remedy for a change beyond on/off: author a copy under a new name as a `sys_webhook` row, and switch the declared one off.
- **`label` and `description` on a declared webhook are no longer shown anywhere.** The seeded row was their only reader. They are display-only, so no delivery changes; the liveness ledger marks them dead, owed enforce-or-remove.

On a database an 18.0 install created (expand first — nothing is moved or deleted):

- The rows the 18.0 seeder wrote stay where they are. A pristine one (`managed_by: 'package'`, not `customized`) is ignored in favour of its declaration, so a declared webhook is never delivered twice; it follows the declaration's URL and switch, as the seeder's rewrite on every boot made it do.
- A seeded row an administrator edited (`customized: true`), or a row an administrator authored under a declared name, answers as itself, and the declaration is not dispatched beside it — an administrator's `active: false` on a noisy webhook keeps holding. This is logged at `warn` once per name per process, with the remedy.
- A seeded row whose declaration was removed keeps delivering, as it did on 18.0.
- Redelivering an old delivery of a pristine seeded row is judged by the declaration that now answers for it, so a webhook switched off through the ledger is not re-sent.

Deleting the seeded rows, and re-pointing their `sys_http_delivery` history at the declaration, is the ownership ceremony's `declared-webhooks` step (`os migrate organization-ownership`).
