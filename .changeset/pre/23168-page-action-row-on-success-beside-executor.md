---
'@objectstack/spec': minor
---

feat(spec)!: a page action row's `onSuccess` is refused beside a console runner built-in other than `api` / `script`, and beside a row with no executor; `ActionSchema`'s `onSuccess` refusal now states its true reason

Clause-②: no (narrowing)

<!-- adr-0087: registered ui-page-action-row-on-success-beside-executor-refused -->

**BREAKING**: an accept-set narrowing on one key of four published page component rows, shipped as `minor` under the launch-window convention for accept-set narrowings.

The page action rows are `action:button` and `action:icon` (`properties`), and each member of an `action:group` or `action:menu` (`properties.actions[]`). Each forwards `onSuccess` to the console's action runner, which performs the post-success hop after every executor that succeeds. `ActionSchema` refuses `onSuccess` beside any `type` but `api` and `script`; the rows judged it beside no executor at all. They now carry the action's rule on the vocabulary the action's closed `ActionType` can see, read against the row's effective executor (the executor key, or the row's `name` when that key is omitted or empty, as the runner resolves it):

- refused beside the runner built-ins `url`, `navigation`, `modal`, `flow` and `form`;
- refused on a row with no effective executor (no executor key, or an empty one, and no `name`);
- accepted beside `api` and `script`, and beside any other name: that is a handler a host registers, the runner hops after it too, and only the host knows whether its handler navigates.

`ActionSchema`'s own reach is unchanged (`url`, `modal`, `flow` and `form` are refused, as before). Its message used to say that on those types the key "would parse clean and never run" and that "no renderer reads a post-success hop today". Both were false: the runner hops after every executor. The action and the rows now print one refusal text with the true reason for each executor.

### FROM → TO

| before | what to write instead |
| --- | --- |
| `{ actionType: 'url', target: '/tasks', onSuccess: { navigate: '/done' } }` (or `type: 'url'` on a member, or `name: 'url'` with no executor key) | the destination in `target`, the tab in `openIn`, and no `onSuccess`: the url action is itself the navigation, so the hop navigated a second time |
| the same with `navigation` | the same, with `actionType: 'url'` (the alias is refused at the executor key as well) |
| `{ actionType: 'form', target: 'task_form', onSuccess: … }` | no `onSuccess`; declare where a submitted form goes in the form view's `submitBehavior` |
| `{ actionType: 'modal', … , onSuccess: … }` or `{ actionType: 'flow', … , onSuccess: … }` | no `onSuccess`, or move the hop onto an `api` or `script` action, whose result it reads |
| `{ label: 'Go', onSuccess: { navigate: '/tasks' } }` (no executor key and no `name`) | declare the executor whose success the hop follows, `actionType: 'api'` or `actionType: 'script'` (`type` on a member), or drop `onSuccess` |

**The one-line fix: keep `onSuccess` only on a page action row whose executor is `api`, `script` or a host-registered handler, and declare that executor.** `os migrate meta --from 17` lists the D3 entry `ui-page-action-row-on-success-beside-executor-refused`; the rewrite is by hand, because where the hop belongs is the author's call.

**What an author now sees.** `os validate`'s props gate reports the refusal at the row's `onSuccess` (`properties.onSuccess`, or `properties.actions.N.onSuccess` for a member). For example, `{ actionType: 'url', target: '/tasks', onSuccess: { navigate: '/done' } }` on an `action:button` gets: ``An `action:button`'s `onSuccess` (`actionType: 'url'`) would navigate a second time: a `url` action is itself the navigation, and the console's action runner performs the post-success hop after every executor that succeeds.``, followed by what the hop is declared beside and the prescription. The same row without `onSuccess` parses unchanged.

**Measured producers.** None in this repository or in hotcrm (at `0f84c9c`). In objectui (at its pin `1fb1ced36243` and its main `72594f29`), one test row with no executor and no `name` carries `onSuccess` and is asserted accepted; its remedy is to declare `actionType: 'api'` on that row. A host-handler row (`actionType: 'run'`) with `onSuccess` stays accepted.
