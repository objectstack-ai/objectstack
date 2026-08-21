---
"@objectstack/service-settings": patch
"@objectstack/spec": patch
---

**Behaviour change (tightening, boot-time only):** a settings write issued before `SettingsService`'s data engine is bound is now **refused loudly** instead of resolving successfully while nothing reaches `sys_setting` (#10159).

`upsertRow` picks its store on `if (this.engine)`, and the engine is bound in exactly one place — `SettingsServicePlugin` registers a `kernel:ready` hook from its `start()` and calls `bindEngine` inside it. `kernel:ready` handlers run in registration order and every plugin's `init()` runs before any plugin's `start()`, so **every `kernel:ready` hook registered from an `init()` fires inside that window**. A `set()` from there landed in the in-process memory fallback, re-resolved off that same array, and handed the caller a fully resolved value; `sys_setting` received nothing, and neither audit ledger recorded anything (both sinks bind on the same `bindEngine` call). Nothing was logged at any level, because the write did not fail — it succeeded against the wrong store.

**What an operator will now observe.** A write in that window throws `SettingsEngineNotBoundError` — code `SETTINGS_ENGINE_NOT_BOUND`, status **503** — whose message names the window, the reason, and the fix: move the write to `kernel:bootstrapped` (or later), which fires strictly after every `kernel:ready` handler has settled. Previously that same call returned a resolved value and the setting was silently absent after restart.

**Nothing outside the window changes.** The refusal is armed only by the new opt-in `SettingsServiceOptions.engineBindPending`, which `SettingsServicePlugin` sets in `init()` and clears on both branches of its `kernel:ready` hook — by `bindEngine` when `objectql` is present, or by the new `SettingsService.settleWithoutEngine()` when it is not. So:

- a `SettingsService` constructed directly (unit tests, bootstrap, control-plane mock) keeps the in-memory fallback exactly as before — it declares no pending bind, and the guard never arms;
- a lean kernel with no `objectql` keeps the plugin's deliberate degradation: once its `kernel:ready` hook has established that no engine is coming, writes resolve into the memory fallback again (now with a `warn` saying those values are lost on restart);
- reads are untouched in every state, so an ordinary boot-time read of a setting still resolves.

No shipped caller wrote settings inside the window, so no existing startup sequence becomes an error.

`SETTINGS_ENGINE_NOT_BOUND` is registered in `ERROR_CODE_LEDGER` per ADR-0112. The status is declared on the error class rather than at an HTTP door because no door can reach it: the window closes at `kernel:ready`, and HTTP servers open their socket at `kernel:listening`, strictly after.
