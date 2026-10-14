---
'@objectstack/verify': minor
---

feat(verify): the handle gains a door that observes the writes the engine receives, a hook's refused write included

Clause-②: yes (widening)

An app's tests can see what a hook handed the engine through the in-process handle, so a suite no longer wraps the booted engine's write methods in a spy to find a refused write, to wait for a fire-and-forget hook, or to stage a refusal.

- **`stack.observeWrites(fn)`** runs `fn` and resolves with every insert, update and delete the booted engine received meanwhile, in the order each reached it. Each entry (`ObservedWrite`) carries `object`, `operation`, the payload (`data`), the update or delete selection (`where`), `multi`, the execution context the write carried (`context`), and the engine's answer (`outcome`): `pending`, then `resolved` with its result, or `refused` with the error the engine threw, unchanged, and that error's own `code`.
- **What it is.** One global middleware on the engine's own chain (`registerMiddleware`), added on the first call. It passes every operation on unchanged and decides nothing. So it sits after the write gates the boot registered. Every write those gates let through is recorded, from any door (`hooks.run`, `seed`, a flow, a route, a hook's `ctx.api`), and so is every refusal the engine raises past them: a declared validation rule (`VALIDATION_FAILED`), a hook's throw, a unique conflict (`DUPLICATE_RECORD`). A write a gate refuses, the permission check among them, never reaches it and leaves no entry. Its refusal still reaches whoever made the write.
- **An outcome is the engine's answer to that call, not a statement about stored rows.** A write an `after*` hook refuses was refused after the driver wrote, and its row can stay. Read rows back with `stack.rows`.
- **The window is time, not cause.** A write the stack makes for its own reasons while `fn` runs is recorded too, so filter by `object`.
- **An `async: true` hook.** Its write reaches the engine after the write that fired it has returned. `fn` is handed the live observation (`WriteObservation`), and `observation.settled(match)` resolves with the first write `match` accepts once the engine has answered it. It rejects after `timeoutMs` (default 2000), naming every write observed, or when the observation closes first. A hook that writes nothing leaves nothing to observe.
- **Staging a refusal.** Arrange one the engine makes itself: seed the row that already holds a unique value the hook will write, or set up the state a declared validation rule refuses. The handle has no switch that refuses a write in the engine's place.
- A `fn` that is not a function, a `match` that is not a function, and a `timeoutMs` that is not a positive number are refused with `code: 'INVALID_REQUEST'`, `status: 400`. A rejection of `fn` is rethrown unchanged once the observation has closed. No error code is added.
- New exported types: `ObservedWrite`, `ObservedWriteOutcome`, `WriteObservation`.
