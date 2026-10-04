---
'@objectstack/metadata-protocol': patch
---

The data door's object-existence gate builds its `OBJECT_NOT_FOUND` from the shared factory, and two best-effort readers treat the engine's refusal of their own object as the not-provisioned case

Clause-②: no

- `assertObjectRegistered` (the data door's object-existence gate) now throws `objectNotFoundError(object)` from `@objectstack/core`. The code, the status, the `object` field and the message are unchanged, byte for byte.
- `SeedLoaderService.resolveSoleOrganizationId` and the history counters `SysMetadataRepository` reads (`version`, `event_seq`) already answered a missing table of their own object as "nothing here yet". `@objectstack/objectql` now refuses an object name its registry does not hold with `OBJECT_NOT_FOUND` instead of reaching the driver, so each reader also answers that refusal as the same absence when the error's own `object` is the object it read. A refusal naming another object, and every other read failure, still propagate. With a registered object nothing changes.
