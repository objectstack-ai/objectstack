---
'@objectstack/spec': minor
---

feat(spec)!: a page action row is judged by `ActionSchema`'s declarative-update rules, from the one judge both read

Clause-②: no (narrowing)

<!-- adr-0087: registered ui-page-action-row-declarative-update-rules -->

**BREAKING**: an accept-set narrowing on four published page component rows, shipped as `minor` under the launch-window convention for accept-set narrowings.

The page action rows are `action:button` and `action:icon` (`properties`), and each member of an `action:group` or `action:menu` (`properties.actions[]`). Each forwards `operation`, `patch`, `params`, `target`, its executor key and `locations` to the console's action runner, which reads `operation` before any executor: `operation: 'update'` posts the write through the platform action route and runs no executor of its own. `ActionSchema` refused the shapes below on an action, and the rows accepted them. The rows now apply the same judge (`ActionSchema`'s texts are unchanged), with the executor spelled as the row spells it (`actionType` on a node, `type` on a member):

- `patch` without `operation: 'update'` is refused at `patch` (it is never written);
- beside `operation: 'update'`:
  - an executor other than `'script'` is refused at the executor key;
  - `target`, `method`, `bodyExtra`, `bodyShape` and, on `action:button`, `recordIdField` are each refused at their own key;
  - a row with nothing to write is refused at `patch`;
  - a `list_toolbar` location is refused at `locations.N`;
- a row's `patch` is `ActionSchema`'s own record of field values: a string, array or number `patch` is refused at `patch` (the runner dropped it before the write).

On `action:button` and `action:icon`, a non-empty object `params` (the node's static values, which the write merges over `patch`) counts as something to write. On a container member it does not. Beside the operation, the rows' url-target and `'navigation'` rename refusals stand down, because the update's refusal of `target` and of the executor covers both keys.

### FROM → TO

| before (on a row) | what to write instead |
| --- | --- |
| `{ actionType: 'script', patch: { status: 'done' } }` (no `operation`) | `{ operation: 'update', patch: { status: 'done' } }` for the write, or drop `patch` |
| `{ operation: 'update', patch: { status: 'done' }, target: 'close_task' }` | the same row without `target`: the platform action route performs the write |
| `{ operation: 'update', patch: { status: 'done' }, actionType: 'url' }` (or `type` on a member, or any other executor) | the same row with no executor key, or `'script'` |
| `{ operation: 'update', patch: { … }, method: 'PATCH' }` (likewise `bodyExtra`, `bodyShape`, `recordIdField`) | the same row without that key (static field values go in `patch`) |
| `{ operation: 'update' }` (no `patch`, empty `params`) | add `patch: { … }`, or `params` that supply the values |
| `{ operation: 'update', patch: { … }, locations: ['list_toolbar'] }` | a record location (`list_item`, `record_header`, `record_more`, `record_section`), or a list view `bulkActionDefs` entry for the selection bar |
| `{ operation: 'update', patch: 'done' }` | `patch: { status: 'done' }` |

A row that meant a call of its own keeps its executor and `target`, and drops `operation` and `patch` instead.

**The one-line fix: write a page action row's declarative update as `ActionSchema` accepts it, with `operation: 'update'` and a `patch` record, no executor or `'script'`, no dispatch keys, and record locations only.** `os migrate meta --from 17` lists the D3 entry `ui-page-action-row-declarative-update-rules`; the rewrite is by hand.

**What an author now sees.** `os validate`'s props gate reports each refusal at the row's own key (`properties.…`, or `properties.actions.N.…` for a member), with `ActionSchema`'s text. For example, `{ operation: 'update', patch: { status: 'done' }, actionType: 'url' }` on an `action:button` gets ``… so `actionType` names that route or nothing; leave it off. …`` at `properties.actionType`.

**Measured producers.** None in this repository: its examples, the CLI corpus, the dogfood fixtures and the package tests carry none, apart from these rows' own pins. Two landed pins put `api` or a host handler beside the update, and they now name `'script'`. In objectui, at its pin `b9814b334` and its main `524136e`, no page action row with these shapes is parsed by the spec. One renderer-test control mounts an `action:button` with `patch` and no `operation`, to show nothing is written.
