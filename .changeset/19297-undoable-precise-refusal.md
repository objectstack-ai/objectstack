---
'@objectstack/spec': minor
---

**BREAKING for authored metadata** — `undoable: true` on a registered `action` is now legal only on a shape some runtime actually fulfils, and refused at parse time everywhere else.

Clause-②: yes

The accept set narrows. `undoable` was a plain optional boolean that no refinement read, so it parsed clean on every action shape while only two of them ever produced an Undo — the declared-but-inert case the spec refuses at author time (ADR-0078).

**The two fulfilled shapes, and which runtime fulfils each**

| shape | who takes the snapshot |
| --- | --- |
| `operation: 'update'` (with a `patch`) | the framework runtime — the prior value of every field in the merged write bag, `patch` UNDER the collected `params` |
| `type: 'api'` | the pinned console — it builds the undo envelope from `undoable` alone |

Both stay accepted, byte-identically. Naming the console in the contract is deliberate: the spec is the contract for every runtime including the console, and a closed table of fulfillable combinations is what the declared-is-delivered rule asks for.

**What is refused**

`undoable: true` on `type: 'script'` (the default route) or `type: 'url'`, and on the dormant `type: 'flow'` / `'modal'` / `'form'`, in each case without `operation: 'update'`. Nothing reads the flag on those shapes, so it promised an Undo that never appeared.

```
✗ undoable: `undoable: true` has no runtime that can fulfil it on this action. An Undo is
  captured on exactly two shapes: `operation: 'update'`, where the framework runtime snapshots
  the prior value of every field the write bag touches, and `type: 'api'`, which the console
  snapshots. …
```

**⛔ What is deliberately NOT refused, because it was measured wrong.** Requiring `operation: 'update'` — the obvious repair — would refuse the published `ReassignLeadAction` skill example (`type: 'api'` + `undoable: true`, no `operation`) at import time, since `defineAction` IS `ActionSchema.parse`, and every console api action with undo along with it. The console's two readers gate the undo envelope on `action.undoable` alone with zero reads of `action.operation`, and those same two files are the entire recorded evidence for this package's own liveness verdict `action/undoable: live`. `undoable` absent or `false` is untouched on every type, and the rule lives on `ActionSchema`'s refine chain alone — an inline action is not a registered action.

### Migration — FROM → TO

| You wrote | Write instead |
| --- | --- |
| `{ type: 'script', body, undoable: true }` | `{ operation: 'update', patch: { … }, undoable: true }` if the action is a single-record field write, or drop `undoable` and keep the handler |
| `{ type: 'url' \| 'flow' \| 'modal' \| 'form', undoable: true }` | the same action without `undoable` — those routes never had a capture, so behaviour is unchanged |

⛔ Not mechanically convertible, so this ships as an ADR-0087 D3 structured TODO rather than a D2 conversion: which of the two fulfilled shapes an author meant is an intent no artifact records — a `script` action with an inline handler and an api action calling an endpoint are different dispatches, not two spellings of one — and dropping the flag automatically would remove an Undo the author asked for.

<!-- adr-0087: registered ui-action-undoable-unfulfillable-refused -->

**Published surface.** No export is added, removed or renamed; `ActionType` still carries all six types. The `undoable` `.describe()` and the comment above it are corrected in the same change: both claimed that an action with no `operation` has nothing anchoring the capture, which is false against the pinned console.
