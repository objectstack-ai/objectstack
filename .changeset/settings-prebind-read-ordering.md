---
"@objectstack/plugin-email": patch
"@objectstack/service-sms": patch
"@objectstack/service-storage": patch
"@objectstack/service-settings": patch
---

Make the settings ordering contract **declared and enforced**, and make the
residual pre-bind READ audible (#10250).

`SettingsServicePlugin` binds its data engine from a `kernel:ready` hook
registered in its `start()`. Three shipped plugins read a settings namespace
from a `kernel:ready` hook registered in *their* `start()` — `plugin-email`
(`mail`: SMTP/provider/from-address), `service-sms` (`sms`: provider
credentials and the daily cost ceiling) and `service-storage` (`storage`:
backend and credentials). Hooks fire in registration order, so a reader that
started before the settings plugin read `SettingsService`'s in-memory fallback,
which is empty at boot: the caller received the manifest **default** with
`source: 'default'` and `locked: false`, no diagnostic anywhere, while the
operator's saved row sat unread in `sys_setting`.

Nothing constrained that order. None of the three declared any dependency on
`com.objectstack.service.settings`, so their position was pure `kernel.use()`
order. It was correct under `os serve` only because the always-on slate happens
to list `settings` first — and `serve` *prepends* an app's declared `requires`,
so an ordinary `requires: ['email']` produced email-before-settings and bypassed
that; cloud's per-tenant runtime mounts the slate from its own wiring.

Three changes, one contract:

- **Declared order.** Each of the three plugins now declares
  `optionalDependencies: ['com.objectstack.service.settings']`. The kernel
  resolves both the init and the start phase from that graph
  (`resolvePluginOrder`, ADR-0116), so the bind is ordered ahead of the read
  wherever the plugin is composed, in any host. Soft, not hard: a kernel with
  no settings service still boots these plugins unchanged.
- **The residual is audible.** A settings read issued while a bind is
  *declared but pending* now emits one operator-actionable `warn` per namespace
  naming the repair. Deliberately not a refusal — an in-window read of a
  setting with genuinely no persisted row must answer the manifest default, and
  refusing would turn a correct startup sequence into an error. It stays silent
  in every case that is not the window: after `bindEngine`, on a kernel with no
  `objectql` at all (`settleWithoutEngine`), for a directly constructed
  `SettingsService`, and for a read satisfied by an `OS_*` env override.
- **The slate pin now derives its boundary.** The foundational-prefix
  assertion covered `slice(0, 6)` while `sms` — a settings reader — sits at
  index 6, one past the end. The new pin
  (`packages/cli/src/commands/serve-settings-ordering.pin.test.ts`) states the
  rule instead of the count: every always-on entry that is not one of the
  services others bind into at `kernel:ready` must be mounted after all of
  them. An entry added tomorrow is covered wherever it lands.

No behaviour changes for a deployment whose order was already correct.
