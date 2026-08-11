---
"@objectstack/service-settings": patch
---

fix(service-settings): redact encrypted setting values at the REST read boundary (#7522)

`GET /api/settings/:namespace` returned the **plaintext** of every encrypted
setting in the namespace — in `values.<key>.value` and repeated once more in each
`cascadeChain` entry. Both specifier flavours were affected: `type: 'password'`
and an explicit `encrypted: true`. Storage was never the problem
(`sys_setting.value` is null, `value_enc` holds a `sec_` handle, and `sys_secret`
holds aes-256-gcm ciphertext); the leak was entirely on the way out.

The endpoint requires `setup.access`, so this is defense-in-depth rather than
privilege escalation — but every operator, integration, proxy, browser cache and
HAR capture on that response path received the cleartext of every secret in the
namespace, which is precisely what the `value_enc` + `sys_secret` split exists to
prevent.

**What changed.** The REST handlers now redact before the payload leaves the
process, reusing the mask convention ADR-0100 already pins for encrypted
*fields* on the generic CRUD path rather than inventing a sentinel:

- **Read** — a set secret is served as `SETTINGS_SECRET_MASK` (`••••••••`, the
  same eight bullets as objectql's `SECRET_MASK`); an unset one stays `null`. The
  redaction is presence-preserving, so "configured vs not configured" is still
  readable, and it covers `cascadeChain` entry by entry as well as the effective
  value. `source`, `locked`, `lockedReason` and the `409 SETTINGS_LOCKED`
  env-lock behaviour are untouched.
- **Write** — a submitted value equal to the mask means "unchanged" and the key
  is dropped from the patch, so a form round-trip that echoes what it read does
  not overwrite the stored secret with the mask's literal text. The drop is
  scoped to secret keys: a plain setting whose value genuinely is eight bullets
  still writes verbatim. `PUT`'s own response is redacted the same way — it
  carries resolved values too, including cascade entries the caller never
  submitted.

**What deliberately did not change.** `SettingsService` still decrypts.
`materialiseRow()`, `get()`, `getNamespace()`, `snapshotOf()` and `createClient()`
keep returning real plaintext, because the mail / sms / storage / auth plugins
read their credentials through exactly that path. Redaction belongs to the REST
boundary and nowhere else; a test pins the in-process round-trip so this cannot
be "fixed" one layer down.

New public API on `@objectstack/service-settings`: `SETTINGS_SECRET_MASK`,
`redactSecretValues`, `dropEchoedSecretMasks`, and
`SettingsService.secretKeysOf(namespace)` — published so a client can recognise a
masked read instead of comparing against a hard-coded string.
