---
"@objectstack/service-storage": patch
"@objectstack/service-sms": patch
---

fix(service-storage,service-sms): a schema default is not a configuration — converge the "authored value" criterion on `ResolvedSettingValue.source` (#5536)

Both settings-bound plugins decided "has anyone configured this namespace?" by
value presence, but the manifest defaults are non-empty on every boot, so an
unopened settings page read as configuration:

- **service-storage**: the swap gate now requires an adapter-relevant key
  (`adapter`, `local_root`, `s3_*` — exactly the inputs `resolveStorageTarget`
  reads) whose `source` is not `'default'` before settings may override the
  constructor-built adapter. Previously the schema defaults
  (`adapter: 'local'`, `local_root: './.objectstack/data/uploads'`) could
  silently move a deployment's declared backing store — and an authored save
  that touched only, say, the upload limit could open the same door.
- **service-sms**: the downgrade to `LogSmsTransport` now requires an
  operator-authored `provider: 'log'` (`source !== 'default'`). Previously
  the manifest default `'log'` — a value nobody selected — switched off the
  transport the deployment declared via constructor options on every boot.

Same criterion, same reason as `EmailServicePlugin` (the in-repo precedent):
the manifest default (`source: 'default'`) is not a decision anyone made.
Admin-saved rows and env overrides behave exactly as before. A snapshot with
no `source` at all reads as `'default'` — the conservative side keeps the
deployment-declared adapter/transport. The sms `daily_quota` reader keeps its
declared #2814 exception and still binds by value, never by source.
