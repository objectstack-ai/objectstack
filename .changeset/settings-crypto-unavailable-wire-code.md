---
"@objectstack/spec": minor
"@objectstack/service-settings": minor
---

feat(settings): `SETTINGS_CRYPTO_UNAVAILABLE` gets a wire spelling — the fail-closed settings refusal is now client-branchable (#8273)

The #8026 fail-closed refusal (a declared-encrypted setting refused when
nothing able to encrypt it is wired) used to answer over REST on the generic
`500 INTERNAL_ERROR` arm every unmapped service error takes. The full
actionable message was carried, so operators reading logs were fine — but a
client (the Setup UI is the consumer) could not distinguish "the deployment
cannot encrypt secrets, reconfigure it" from "the server crashed". Every other
settings error class already had a registered wire code; this one was the odd
one out.

- `SETTINGS_CRYPTO_UNAVAILABLE` is registered in `ERROR_CODE_LEDGER` under
  `@objectstack/service-settings`, so `ApiErrorSchema.code` accepts it
  (ADR-0112: declared = enforced, no silent fourth state).
- `settings-routes.ts`'s PUT handler maps `SettingsCryptoUnavailableError` to
  `500 SETTINGS_CRYPTO_UNAVAILABLE` with `details: { namespace, key }` (the
  located refusal — never the value). The status **stays 500**: this is a
  server-side misconfiguration, and deliberately not 503 — no retry succeeds
  until an operator wires a `cryptoProvider`, so inviting one would be
  dishonest. The registered code carries the meaning; the status stays honest.

Clients branching on the previous generic `INTERNAL_ERROR` for this refusal
(none could, meaningfully — that was the bug) now read the dedicated code;
status and message are unchanged.
