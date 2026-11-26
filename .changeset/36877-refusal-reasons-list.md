---
'@objectstack/spec': minor
'@objectstack/runtime': minor
'@objectstack/types': minor
---

feat(refusals): one refusal names several declared reasons, each in the person's language

Clause-②: yes
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-data/references/data-hooks.md, skills/objectstack-ui/rules/actions.md

A hook or a `script` action that declares `refusals` can now refuse with several declared sentences at once, for example when it checks a whole selection and refuses all of it. Under one declared code it throws an ordered list of the code's declared reasons, each with its own `params`, instead of one `reason`:

```js
throw { code: 'SUBMIT_REFUSED', params: { count }, reasons: [
  { reason: 'on_report', params: { name: 'Taxi 12' } },
  { reason: 'approved', params: { name: 'Hotel 7' } },
] };
```

- Each listed reason's sentence is picked in the caller's locale and its holes are filled from that reason's own `params`, as a single reason's sentence is. The answer's `userMessage` is those sentences joined by a line break, in the order thrown, then the code's own `message` as the last line (its holes are filled from the throw's top-level `params`). The code's status and the code on the wire are unchanged.
- Every door that answers the refusal also carries the sentences structured, as `details.refusals: [{ reason, message }, …]`. The `/data` door bounds `userMessage` at 500 characters as before; `details.refusals` keeps every sentence whole.
- Every listed reason must be one the code declares under `reasons`. One that is not makes the whole throw the loud `500` fault naming the hook or action, the code and the reason. Under a code that declares no `reasons`, every listed reason is undeclared. A literal list in the source (`throw { code, reasons: [{ reason: 'x' }] }`, or `e.reasons = [{ reason: 'x' }]` on an error the body throws) is refused when the hook or action is saved.
- A throw that carries both a `reason` and a `reasons` list, an empty list, or a `reasons` value that is not a list of `{ reason, params? }` is the same loud fault.
- The sandboxed body and the in-process hook handler read the list the same way and answer byte-identically.

The catalogue entry (`message`, `status`, `reasons`, `params`) and the translation keys do not change, so no `os i18n` key is added. A throw with one `reason`, or none, is answered exactly as before.

New exports: `@objectstack/spec` adds `isUndeclaredThrownReason`, `unreadableHookRefusalListAtRun`, `unreadableActionRefusalListAtRun` and the `HookRefusalThrownReason` and `RefusalListProblem` types (`data`); `hookRefusalReasonsThrownIn` now answers `HookRefusalThrownReason[]` (a listed pair carries `listed: true`). `@objectstack/types` adds `declaredRefusalLines` and the `DeclaredRefusalLine` type. `@objectstack/runtime` adds no export; its `SandboxError` gains an optional `refusals`, the list the doors read.
