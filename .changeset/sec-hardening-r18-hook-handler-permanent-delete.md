---
'@objectstack/objectql': patch
'@objectstack/runtime': patch
---

fix(objectql,runtime)!: an app-authored hook handler's permanent delete is refused

Clause-②: yes (narrowing) — the in-process `handler` of a hook bound from metadata is app-authored code, and its `ctx.api` now refuses `delete(…, { permanent })` with any value but `false`, under every `runAs`, on every api derived from it; a handler that passed the key past `HookDeleteOptions` with a cast and purged the record is refused instead.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no metadata value changes meaning; HookDeleteOptions already omits permanent. The refusal is the 400 VALIDATION_ERROR sandboxed bodies already answer, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing on the `ctx.api` an app-authored hook's in-process `handler` holds (`@objectstack/objectql`).

App-authored code cannot delete a record permanently: its deletes enter the recycle bin, and the permanent delete stays with a principal that holds `manageRecycleBin` (ADR-0148 D3). A sandboxed hook, action or job body was already held to this. A hook bound through the hook binder with an in-process `handler` is app-authored too, and its `ctx.api.object(name).delete(…)` with `permanent` set to anything but `false` now answers `400 VALIDATION_ERROR`, `param: 'permanent'`, with the same sentence a body gets, before anything is removed. It holds under the triggering caller, under `runAs: 'user'` and under `runAs: 'system'`, by id and in bulk, and on the apis `sudo()`, `withRunAs(...)` and a transaction derive. The handler's ordinary delete (no `permanent`, or `permanent: false`) is unchanged and enters the bin.

Platform code is unchanged: `engine.delete(…, { permanent: true })`, `engine.createContext(...)`, a hook registered in code with `engine.registerHook`, and `purge` / `empty` keep the permanent delete.

The refusal now lives in `@objectstack/objectql` (`refuseAppAuthoredPermanentDelete`), and the runtime's sandbox applies that same refusal to every body (`@objectstack/runtime`). It reads the delete's options once, into a copy, and the delete receives that copy.
