---
'@objectstack/spec': minor
'@objectstack/runtime': minor
'@objectstack/lint': minor
---

feat(spec,runtime): a hook written as a TypeScript `handler` can declare `refusals`, and a refusal code can hold several declared sentences with parameters

Clause-②: yes
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-data/references/data-hooks.md (the "Declared refusals (`refusals`)" section teaches a sandboxed `body` only, one sentence per code, no params), skills/objectstack-i18n/SKILL.md (the `hooks.<hook>.refusals.<CODE>.message` row has no `reasons` key)

A hook's refusal catalogue (`HookSchema.refusals`) is answered on every path the hook runs on, and an entry can hold more than one sentence (maintainer ruling 6879477573: letter A, S1, params; inside ruling 6431311681 letter A).

- **A `handler` hook may declare `refusals`.** `defineStack`, `os validate`, `os build` and the metadata save door used to refuse `refusals` on a hook with no `js` body. They now accept it on a hook whose `handler` is an inline function or a string reference. An undeclared code that the handler's source throws literally is refused at save, at `handler`. The catalogue is answered on every path: the body `os build` lowers the handler to (as before), and the in-process handler of a source boot (`bootStack(config)`, `os serve` over a host config), plus the function a string `handler` names when the build could not lower it. Both answer with the same envelope. An error a `ctx.api` or `ctx.ql` call raised, which the handler lets through unchanged, passes through as it does on the body path. Still refused: `refusals` on a hook whose code cannot throw a code (an `expression` body, or neither a body nor a handler).
- **`reasons`: several sentences under one wire code.** `refusals.CODE.reasons.REASON.message`, with a snake_case reason. The hook throws `{ code, reason }`. The caller reads the reason's sentence, with the code and the status of its entry, so the wire code and the envelope are unchanged. A reason the code does not declare is refused loudly: at save where the hook's source throws it literally, otherwise at run time as a `500` naming the hook, the code and the reason. Translated through `hooks.HOOK.refusals.CODE.reasons.REASON.message`. `os i18n extract` and `os i18n check` count each declared reason, and `os validate` refuses a translation key over a reason the code does not declare (`translation-target-unknown`).
- **`params`: names a sentence may fill.** An entry declares `params: ['state']`, and its sentences (its `message` and each reason) may write a double-brace hole over those names. The hook throws `params: { state }`. The runtime fills the holes after it picks the translation, through the formula template engine the flow `end` refusal renders with, and only declared names are in scope. A hole over an undeclared name is refused at save. An entry with no `params` stays plain text and every hole in it is refused, as before. The rule is now a refinement (`dropped-refinements.baseline.json` gains `data/HookRefusal`), so the published JSON Schema no longer carries the hole pattern on `message`.

Unchanged: a hook that declares none of the new parts answers byte-for-byte as before (pinned against the base commit's output), and a hook that declares no `refusals` is untouched on both paths.

New exports in `@objectstack/spec/data`: `HOOK_REFUSAL_REASON_PATTERN`, `HOOK_REFUSAL_PARAM_PATTERN`, `hookRefusalReasonsThrownIn`, `undeclaredHookRefusalReasonAtSave`, `undeclaredHookRefusalReasonAtRun`. `hookRefusalMessageKey(hook, code, reason?)` takes an optional reason.
