---
'@objectstack/objectql': patch
---

fix(objectql): the lifecycle sweep no longer runs 60 s after a boot that created its datastore from empty; its first sweep runs one interval later

Clause-②: yes (widening) — the exported `LifecycleEngineLike` gains the optional member `wasDatastoreCreatedFromEmpty?(): boolean` (an engine without it keeps the old schedule); no accept set changes.
Metadata-protocol: none

- `LifecycleService.start()` asks the engine, at the initial delay, whether this process created the datastore from empty (`ObjectQL.wasDatastoreCreatedFromEmpty()`, answered from every driver's schema-sync stats without a statement). When it did, the scheduled first sweep is skipped and the sweep runs on the interval, one interval later. Such a store holds no row older than the boot, and no declared window is shorter than an hour, so the skipped sweep had nothing to reap. It still read every declared object, the `lifecycle` settings and every lookup the reference audit walks: 130 statements in the first minute of a hosted tenant kernel's first boot.
- A store that existed before the boot, or an engine that cannot say, sweeps at the initial delay as before. A direct `sweep()` call always sweeps. `OS_LIFECYCLE_DISABLED`, `initialDelayMs` and `sweepIntervalMs` keep their meaning.
- `LifecycleEngineLike` gains the optional member `wasDatastoreCreatedFromEmpty?(): boolean`. An engine double that omits it keeps the old schedule.
- A re-boot on an existing store still sweeps at the initial delay. Persisting a last-swept watermark for that case is separate work.
