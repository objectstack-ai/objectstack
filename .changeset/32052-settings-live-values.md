---
'@objectstack/service-settings': patch
'@objectstack/spec': minor
---

feat(service-settings, spec): a settings page read serves the values its keys have in the running system, as the runtime that owns them states them

Clause-②: yes (widening)
Metadata-protocol: added

`GET /api/settings/:namespace` now answers an optional `live` field beside `values`: `{ provider: { value: 'openai', source: 'environment' } }`. `values` says what the settings resolve; `live` says what is in use, which can come from elsewhere. With nothing saved, the AI runtime detects its provider from its own boot environment, so `values.provider` reading `null` never meant the built-in AI was off. `source` is `settings`, `environment` or `none`. A key absent from `live`, or no `live` at all, means not stated (unknown), which is not `none`. The field sits behind the page's own read permission (`manage_platform_settings` for `ai`).

A runtime fills it through the existing live-status seam: `registerLiveStatus(namespace, provider)` answers may now carry `values: { KEY: { value, source } }` (type `SettingsLiveValue`). Only an option-bearing key may be named, and only with a value its option table admits, so a served value is always one of the page's own options and never a credential. Only `value` and `source` are served. An entry that breaks this is left out and logged once per read without its value; the banner and the other entries stand. `SettingsService.liveStatementOf` returns the banner and the live values from one provider call; `liveStatusOf` still returns the banner alone.

`SettingsNamespacePayloadSchema` gains the optional `live` field. A page with no live-status provider, or one that states only a banner, answers exactly as before.
