---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/runtime": minor
---

feat(spec,objectql,runtime): declare `ctx.referentialFieldClear` on `HookContextSchema`, populate it on every `set_null` reference-cleanup write, and carry it across the QuickJS sandbox boundary by contract (#13644)

Adopted by maintainer ruling 2026-08-31 (issue #13644, decision record on the
card): a first-class, declared marker for the engine's own reference-cleanup
writes, with both mandated conditions in the same landing — the sandbox carry
and the populate-surface pin.

The engine implements `deleteBehavior: 'set_null'` by UPDATING the row that
HOLDS the lookup, and it builds that cleanup write's context by inheriting the
caller's envelope — so on the path a real request takes (a `DELETE` carrying a
`userId`), `ctx.user`, `ctx.session` and `ctx.input` are identical between the
engine's cascade and a user's hand-clear of the same lookup. An app guard that
freezes settled records had no declared way to yield to the cleanup: the only
prior signal was the operation-private `__referentialFieldClear`, which the
platform's own `__` convention declares outside the contract and which the
sandbox marshalling never carried.

- **spec (minor):** `HookContextSchema` declares `referentialFieldClear`
  (boolean, optional) — `true` exactly when the write is the engine's own
  reference cleanup (clearing the slot, or removing the deleted member from a
  `multiple: true` lookup); absent on every other dispatch. Widens the accept
  set by one optional engine-produced key on the deliberately non-strict
  runtime context shape; nothing previously valid changes meaning.
- **objectql (minor):** `update()`'s hook-context assembly projects the marker
  from the operation envelope onto the declared key, both phases and the
  per-row fan-out included. Pinned write site by write site (scalar clear and
  multi-value member removal, each beside a hand-clear control under the same
  caller identity, plus an envelope-consistency leg) in
  `engine-cascade-delete.test.ts`.
- **runtime (minor):** the QuickJS marshalling carries the declared key into a
  shipped body (`buildSandboxContext` / `installCtx`), so
  `ctx.referentialFieldClear === true` is readable from inside the VM —
  pinned from inside a real QuickJS run in
  `referential-field-clear-signal.integration.test.ts` (⛔ not a kernel-rig
  read; the #11552 declared≠observable family is the reason the ruling makes
  this a condition of adoption).

The operation-private `__referentialFieldClear` stays: it remains the
engine/middleware authorization channel (plugin-security's ownership-anchor
exemption keys on it before any hook runs). The declared key is its read-only
hook-context projection — one fact, two faces, pinned together.
