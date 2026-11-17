---
'@objectstack/spec': patch
'@objectstack/service-settings': patch
'@objectstack/plugin-email': patch
---

fix(plugin-email): a host's own mail transport now reads as in use on `GET /api/settings/mail` (`live.provider` is `{ value: null, source: 'environment' }`)

Clause-②: yes (widening) — the served `live` entry of `GET /api/settings/:namespace` now also admits `{ value: null, source: 'environment' }`; every entry served before is served unchanged
Metadata-protocol: none

A transport the host application hands to `@objectstack/plugin-email` that no `provider` option names (a plain `IEmailTransport`, such as a hosted platform's mail channel) used to leave `live.provider` unstated, so the first-run checklist read mail as not set up while mail was being delivered. The plugin now states it as `{ value: null, source: 'environment' }`: in use, supplied by the environment or host, named by no option.

- `@objectstack/spec`: `SettingsNamespacePayloadSchema.live` documents the reading. A non-null `value` is still always one of the key's options. `value` is `null` when `source` is `'none'` (nothing in use) or `'environment'` (in use, named by no option). Read whether something is in use from `source`, never from `value === null`. `'settings'` always names an option. The schema's shape is unchanged.
- `@objectstack/service-settings`: the live-value judge serves `environment` with a `null` value. `settings` with a `null` value is still dropped, and so is any entry on a key with no option table.
- `@objectstack/plugin-email`: the stock transports (`smtp`, `resend`, `postmark`) read as before. A transport swapped in through `EmailService.setTransport` is still not stated.

A reader that took `value === null` to mean "nothing is in use" should read `source` instead: `source: 'none'` is the only "nothing is in use".
