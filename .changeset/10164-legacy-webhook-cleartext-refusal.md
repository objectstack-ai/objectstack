---
'@objectstack/plugin-webhooks': minor
---

fix(plugin-webhooks): a webhook credential stored as cleartext inside `sys_webhook.definition_json` is refused, at the delivery path and at the write door (#10164)

Clause-②: no (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner and the ADR-0087 disposition below, never by the level).

**Webhooks that still carry the legacy cleartext shape STOP DELIVERING.** A
`sys_webhook` row whose signing secret or custom header map exists only as a
`secret` / `headers` key inside `definition_json` — with nothing stored in the
encrypted `signing_secret` / `headers_secret` column — used to be delivered from
that cleartext with a `warn`. It is now refused, dated `2026-09-23`:

- **Delivery path.** The subscription is PARKED, the same fail-closed shape as an
  encrypted credential that cannot be recovered: nothing is sent, and every
  matching record change is recorded in `sys_http_delivery` as a `dead` row with
  0 attempts, no signature and no headers. Its `error` names the refusal as
  `[VALIDATION_ERROR/400]`, and the drop is reported once at `error`, with
  `code: 'VALIDATION_ERROR'`, `status: 400`, `field: 'definition_json'` and the
  refused `keys` in the log meta.
- **Write door.** A `sys_webhook` insert or update whose `definition_json` carries a
  `secret` or `headers` key, whatever its value, is refused before anything is
  stored (`VALIDATION_ERROR` / `400`, with `object`, `field` and `keys` on the
  error). That covers a raw `PATCH /api/v1/data/sys_webhook`. It also covers a
  Setup-form save that echoes back a legacy blob unchanged. Omitting
  `definition_json`, or writing one without those keys, is unaffected.

**Fix.** Register a `CryptoProvider` (`engine.setCryptoProvider` —
`LocalCryptoProvider` in dev, KMS/Vault in production) and restart. The boot sweep
`migrateLegacyWebhookSecrets` then moves both values into their encrypted columns
and strips them from `definition_json` in one update, and the subscription
re-arms at the next refresh. Or re-author the webhook yourself. Write the key into
`signing_secret` and the header map into `headers_secret` (a JSON object of string
values), then remove both keys from `definition_json`. There is no transition path
for a deployment that runs with no `CryptoProvider`.

Unchanged: authoring. `defineWebhook({ secret, headers })` is written exactly as
before, and the boot materializer still routes each value to its encrypted column.
A row whose encrypted columns are set delivers exactly as before.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authored moves: `packages/spec` is untouched, `WebhookSchema` still declares `secret` and `headers`, and the materializer still routes them to their encrypted columns, so `objectstack migrate meta` has nothing to rewrite and the ledger has no row to gain. What is refused is a stored DATA-row shape on `sys_webhook`, and its converter already ships and runs at every boot: `migrateLegacyWebhookSecrets`, named in the refusal and in the Fix paragraph above. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a data-row sweep (not `registered` / `already-registered`); and the change is runtime behaviour, not a TypeScript declaration (not `runtime-interface-only` / `type-surface-only`). -->
