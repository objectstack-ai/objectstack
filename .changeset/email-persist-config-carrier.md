---
'@objectstack/cli': patch
---

`config.email.persist` now actually reaches the email plugin (#5447)

`EmailServiceConfigSchema` has always declared `persist` — the generated
reference documents it as "Persist to sys_email (default true)" — and
`EmailServicePlugin` has always honoured the constructor option, building no
`EmailPersistence` when `persist === false`. What did not exist was the segment
between them: `resolveEmailCapabilityArg` in `os serve` is the only reader
`config.email` has, and it read every declared key except this one.

So a deployment that wrote `email: { persist: false }` to keep message bodies
out of the database type-checked, parsed, and read as configured — and went on
writing every subject, body and recipient to `sys_email`. Operators who
switched persistence off for PII reasons were not getting what the contract
promised. **If you rely on that row being written, no action is needed; if you
had declared `persist: false` and audited on the assumption it took effect,
those rows exist and are worth reviewing.**

Resolution order, per setting, matching the rest of this resolver:

    OS_EMAIL_PERSIST_ENABLED  >  config.email.persist  >  default (persist ON)

`OS_EMAIL_PERSIST_ENABLED` is new, and reads the same truth table as
`OS_EMAIL_QUEUE_ENABLED` (`1`/`true`/`yes`/`on`, case- and space-insensitive);
that table is now one shared helper instead of two copies. Unlike the queue
flag it is default-ON, because it does not enable a capability — it is the off
switch for one that has always been on. A deployment that declares neither
source is byte-for-byte unchanged: the key is left out of the plugin's
constructor options entirely and the plugin's own default decides.
