---
'@objectstack/service-messaging': patch
---

fix(service-messaging): stop the SQL outboxes from writing `updated_at` on UPDATE — `pnpm dev` no longer floods the console

An idle dev server printed the same warning 48 times a second, forever:

```
WARN Field 'updated_at' is read-only — ignoring incoming change (#2948)
```

`SqlNotificationOutbox.claim()` / `.claimDigest()` and `SqlHttpOutbox.claim()`
open with an unconditional "reap stale in_flight" UPDATE — visibility-timeout
recovery that runs on every dispatcher tick whether or not any row is actually
stale — and every one of those payloads carried `updated_at`. That column is
`readonly` and owned by ObjectQL's builtin `sys_stamp_audit_update` hook, so the
value was stripped by `stripReadonlyFields` and re-stamped by the platform: a
no-op write that cost one warning per call. Three claim paths × 8 partitions ×
the dispatcher's 500 ms tick = 48 identical lines a second, which buried every
real warning and error in the dev log.

`updated_at` is now gone from every UPDATE payload in both outboxes (`claim`,
`claimDigest`, `ack`, `redeliver`); the platform hook keeps stamping it, so
stored rows are unchanged. INSERT still writes both audit columns, as `Date`s —
`created_at` is caller-owned there, and a native `TIMESTAMP` column rejects a
bare epoch-ms number on Postgres.

That last point was also a latent bug this removes: `enqueue()` correctly used
`new Date()`, but the UPDATE paths passed epoch-ms numbers. Nothing broke only
because the strip discarded them before they reached the driver.
