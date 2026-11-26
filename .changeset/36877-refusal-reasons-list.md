---
'@objectstack/spec': minor
'@objectstack/runtime': minor
'@objectstack/types': minor
---

feat(refusals)!: one refusal names several declared reasons, each in the person's language

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: registered refusal-reasons-list-literal-judged -->

**BREAKING** accept-set narrowing beside a widening, shipped as `minor`. The widening is the new `reasons` list below. The narrowing is what that list makes of a `reasons` key that was ignored before: three sources that save and run on the previous release are refused now (see the migration at the end).

A hook or a `script` action that declares `refusals` can now refuse with several declared sentences at once, for example when it checks a whole selection and refuses all of it. Under one declared code it throws an ordered list of the code's declared reasons, each with its own `params`, instead of one `reason`:

```js
throw { code: 'SUBMIT_REFUSED', params: { count }, reasons: [
  { reason: 'on_report', params: { name: 'Taxi 12' } },
  { reason: 'approved', params: { name: 'Hotel 7' } },
] };
```

- Each listed reason's sentence is picked in the caller's locale and its holes are filled from that reason's own `params`, as a single reason's sentence is. The answer's `userMessage` is those sentences joined by a line break, in the order thrown, then the code's own `message` as the last line (its holes are filled from the throw's top-level `params`). The code's status and the code on the wire are unchanged.
- Every door that answers the refusal also carries each listed reason's sentence structured, as `details.refusals: [{ reason, message }, …]`. The `/data` door bounds `userMessage` at 500 characters as before, and `details.refusals` is not bounded, so each listed line stays whole there. The closing line (the code's own `message`) is not on `details.refusals`: on a list long enough that `/data` cuts `userMessage`, the closing line is lost on that door. A client that renders the list reads the lines from `details.refusals`.
- Every listed reason must be one the code declares under `reasons`. One that is not makes the whole throw the loud `500` fault naming the hook or action, the code and the reason. Under a code that declares no `reasons`, every listed reason is undeclared. A literal list in the source (`throw { code, reasons: [{ reason: 'x' }] }`, or `e.reasons = [{ reason: 'x' }]` on an error the body throws) is refused when the hook or action is saved. Only a `reasons` key that is a direct member of the thrown object is a list; one nested deeper (`params: { reasons: [ … ] }`) is the body's own data, as before.
- A throw that carries both a `reason` and a `reasons` list, an empty list, or a `reasons` value that is not a list of `{ reason, params? }` is the same loud fault.
- The sandboxed body and the in-process hook handler read the list the same way and answer byte-identically.

The catalogue entry (`message`, `status`, `reasons`, `params`) and the translation keys do not change, so no `os i18n` key is added. A throw with one `reason`, or none, is answered exactly as before.

New exports: `@objectstack/spec` adds `isUndeclaredThrownReason`, `unreadableHookRefusalListAtRun`, `unreadableActionRefusalListAtRun` and the `HookRefusalThrownReason` and `RefusalListProblem` types (`data`); `hookRefusalReasonsThrownIn` now answers `HookRefusalThrownReason[]` (a listed pair carries `listed: true`). `@objectstack/types` adds `declaredRefusalLines` and the `DeclaredRefusalLine` type. `@objectstack/runtime` adds no export; its `SandboxError` gains an optional `refusals`, the list the doors read.

**Migration (FROM → TO).** Each row was accepted and answered as if the `reasons` key were absent; it is refused now.

| FROM (accepted before, refused now) | Where it is refused | TO |
|:---|:---|:---|
| A literal `throw { code: 'X', reasons: [{ reason: 'y' }] }` where `X` declares no `reasons` (a literal `y` under a code that declares `reasons` without it was already refused) | At save: `HookSchema` / `ActionSchema` at `body.source` (the metadata save door, `defineStack`, `os validate`, compile, an artifact's parse) | Declare `reasons` on `X` with `y` and its `message`, or remove the `reasons` key |
| `e.code = 'X'; e.reasons = [{ reason: 'y' }]; throw e` with `y` undeclared under `X` | At save, as above | Declare `y` under `refusals.X.reasons`, or remove the `e.reasons` assignment |
| A body that throws a declared code with a `reasons` property of its own: an empty list, a value that is not a list of `{ reason, params? }`, a list beside a `reason`, or a list naming an undeclared reason | At run: the loud `500` fault naming the hook or action and the code, where the declared sentence and status answered before | Rename the body's own property (for example to `items`, or put it under `params`), or throw it as the declared list |

One-line fix: a `reasons` key on a thrown refusal is now the declared list, so name only reasons the code declares there, or rename the key.
