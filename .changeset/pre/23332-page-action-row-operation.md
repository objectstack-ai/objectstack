---
'@objectstack/spec': minor
---

feat(spec)!: a page action row declares `ActionSchema`'s own `operation` enum and refuses `onSuccess` beside `operation: 'update'`, with the action's text

Clause-②: no (narrowing)

<!-- adr-0087: registered ui-page-action-row-operation-declared -->

**BREAKING**: an accept-set narrowing on two keys of four published page component rows, shipped as `minor` under the launch-window convention for accept-set narrowings.

The page action rows are `action:button` and `action:icon` (`properties`), and each member of an `action:group` or `action:menu` (`properties.actions[]`). Each forwards `operation` to the console's action runner, which reads it before any executor: `operation: 'update'` performs the declarative write through the platform action route and runs no executor of its own. The rows typed `operation` as an open value and never carried `ActionSchema`'s refusal of `onSuccess` beside `operation: 'update'`, so a row with an `api` or `script` executor, the write and a hop parsed while the same action was refused. Now:

- a row's `operation` is `ActionSchema`'s own enum (one member, `'update'`); `'delete'` and `'custom'` get the action's "bulk-def operation with no row-level form" refusal, and any other value is refused at `operation`;
- a row's `onSuccess` beside `operation: 'update'` is refused whatever executor the row names (or none), with ONE text shared with `ActionSchema`: the hop would follow the write, whose success carries no result `${result.*}` could read.

`ActionSchema`'s reach is unchanged. Its message for the pairing used to open "`onSuccess` is not defined for an `operation: 'update'` action yet"; it now states what the runner does (reads `operation` before any executor, writes, then hops) and keeps the prescription "Drop `onSuccess`".

### FROM → TO

| before | what to write instead |
| --- | --- |
| `{ operation: 'update', patch: { status: 'done' }, onSuccess: { navigate: '/done' } }`, whatever executor the row names | the same row without `onSuccess`: the runner performs the write before any executor, so the hop followed a write whose success declares no result (an executor other than `'script'` beside the operation is refused as well: `ui-page-action-row-declarative-update-rules`) |
| `{ operation: 'delete', … }` / `{ operation: 'custom', … }` on a row | no `operation`: a row delete is the object's own delete affordance, and a row is already the action a bulk def's `'custom'` would name |
| any other `operation` value | `operation: 'update'` with a `patch`, or no `operation` (the runner ran nothing for it) |

**The one-line fix: on a page action row, write `operation` only as `'update'`, and never beside `onSuccess`.** `os migrate meta --from 17` lists the D3 entry `ui-page-action-row-operation-declared`; the rewrite is by hand.

**What an author now sees.** `os validate`'s props gate reports the refusal at the row's `operation` or `onSuccess` (`properties.…`, or `properties.actions.N.…` for a member). For example, `{ operation: 'update', patch: { status: 'done' }, onSuccess: { navigate: '/done' } }` on an `action:button` gets: ``An `action:button`'s `onSuccess` (`operation: 'update'`) would follow a result the contract does not declare: the console's action runner reads `operation` before any executor, …``. The same row without `onSuccess` parses unchanged.

**Measured producers.** None in this repository. In objectui (at its pin `1fb1ced36243` and its main `b9814b3`), the action renderers' own tests carry `operation: 'update'` rows without `onSuccess`, which stay accepted; no row carries another `operation` value or the pairing. objectui's metadata-admin form already clears `onSuccess` when an author switches an action into an update.
