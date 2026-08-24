---
'@objectstack/plugin-auth': patch
---

Apply the workspace's SAVED auth settings at boot — `AuthPlugin` now declares
the settings ordering edge instead of reading in the pre-bind window

`SettingsServicePlugin` registers the `settings` service in `init()` but binds
its DATA ENGINE from a `kernel:ready` hook it registers in `start()`. Between
those two moments the service is resolvable and answers reads — from an empty
in-memory fallback and the manifest defaults, with `source: 'default'` — while
the deployment's real `sys_setting` rows sit unread. Nothing distinguishes that
from "no row exists".

`AuthPlugin` was reading inside that window. Its `start()`-registered
`kernel:ready` hooks reach `getService('settings')` at depth 3 (`runBackfill` →
`ensureAuthSettingsBound` → `bindAuthSettings`) and call
`getNamespace('auth')` in the same tick. Handlers fire in registration order,
registration order is `start()` order, and `AuthPlugin` declared
`dependencies: ['com.objectstack.engine.objectql']` and nothing about settings
— so nothing ordered it after the settings plugin.

On the shipped composition that order was not merely unconstrained, it was
**wrong**: `os serve` does `kernel.use(new AuthPlugin(...))` before the
capability loop registers `SettingsServicePlugin`, and `resolvePluginOrder`
preserves insertion order for plugins with no edge between them. So everything
`applySettings()` derives was computed from DEFAULTS at boot — the ADR-0093
membership policy the D6 backfill runs under, and the `google_*` social-provider
config. `settings.subscribe('auth', …)` only re-applies on a *later* change, so
a workspace that configured auth in Setup and never touched it again kept
booting with the wrong values: authored, stored, and silently not applied.

The repair is one declaration, the same shape the three other shipped readers
(`plugin-email`, `service-sms`, `service-storage`) already carry:

```ts
optionalDependencies = ['com.objectstack.service.settings'];
```

SOFT, not hard — a kernel with no settings service must still boot auth, and
`bindAuthSettings` already returns early when the service is absent.
`requiresServices` would not have done it: that asserts the service is
REGISTERED before `init()`, which it always is, and carries no `start()`
ordering.

Enforced in both directions. `check:settings-bind-window` goes green with the
`com.objectstack.auth` entry **deleted** from its shrink-only ledger — deleting
it while the defect stood reproduces the finding, so the green is a measurement
rather than a suppression. And `auth-settings-ordering.pin.test.ts` resolves a
hostile registry that composes auth BEFORE settings, then removes the
declaration from a live instance and watches the order revert (ADR-0049:
a declaration nothing acts on is the defect, not the fix).
