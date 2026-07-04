---
"@objectstack/service-automation": patch
---

fix(automation): bind flow triggers on a cold boot, not just after an HMR reload

Record-triggered (and other trigger-typed) flows silently never fired on a
fresh process start — in dev and in production. The automation service's
boot-time flow pull reads `ql.registry.listItems('flow')`, which is **empty for
flows defined inline in an app manifest** — `registry.registerApp()` stores the
app under type `'app'` and never promotes its inline flows to standalone
registry `'flow'` items. The re-sync that *could* see them only ran on the
`metadata:reloaded` hook, which never fires on a cold boot (`os dev` restarts
the process on recompile rather than firing it, and production never reloads).

Net effect: after any real restart, **no flow bound its trigger**, so
record-change automations did not fire at all.

Fix: bind flows at `kernel:ready` from `protocol.getMetaItems({ type: 'flow' })`
— the canonical flattened flow view that `GET /meta/flow` serves and that does
surface inline app flows — once every plugin has finished `init()`/`start()`
(so the app, hence its flows, is registered). `registerFlow` is idempotent, so
re-binding a flow the boot pull already registered is harmless.

Verified end-to-end on a clean instance: before the fix, updating a record
fired **0** flows (0 bound at boot); after, a cold boot binds all flows and a
single record update fires every matching record-triggered flow. Regression
test boots a kernel with an inline-app record-triggered flow served only via
`protocol.getMetaItems` and asserts it is bound after `bootstrap()` alone with
no `metadata:reloaded` fired — it fails on the pre-fix code.
