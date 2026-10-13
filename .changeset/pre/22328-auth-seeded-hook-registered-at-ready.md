---
'@objectstack/plugin-auth': patch
---

The auth plugin registers its `app:seeded` membership-backfill handler when its backfill is armed, not when the plugin starts

Clause-②: no

The one-time membership backfill (ADR-0093 D6) re-runs on `app:seeded`, so users written by a seed that settles after `kernel:ready` still get a membership. Its handler used to be registered in `start()` and kept from acting early by a runtime flag: until the backfill's own `kernel:ready` hook armed it, the handler returned without doing anything. The handler is now registered by that `kernel:ready` hook, at the moment it arms the backfill, so it does not exist before the settings engine binds. The boot-ordering gate reads this from the source, which it cannot do with a flag.

- **What the backfill does is unchanged.** An `app:seeded` that fires before the backfill is armed still does nothing, and one that fires after it still re-runs the pass.
- **No option, setting or export changes.** `OS_SKIP_MEMBERSHIP_BACKFILL=1` still registers no `app:seeded` handler at all.
