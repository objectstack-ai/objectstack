---
'@objectstack/spec': minor
'@objectstack/runtime': minor
'@objectstack/lint': minor
'@object-ui/core': patch
---

feat(actions): an action body refuses in the caller's language through a declared refusal catalogue

Clause-②: yes (widening) — an action may now declare `refusals` (`ActionRefusalSchema`); translation bundles accept `objects.<object>._actions.<action>.refusals.<CODE>.message` and `globalActions.<action>.refusals.<CODE>.message` (with `….reasons.<REASON>.message`); `@objectstack/spec` exports `ActionRefusalSchema` and the `ActionRefusal` type (`ui`), `actionRefusalMessageKey` (`system`), and `ACTION_REFUSAL_MESSAGE_HOLE_REFUSED`, `actionRefusalsWithoutSandboxedBody`, `undeclaredActionRefusalCodeAtSave`, `undeclaredActionRefusalReasonAtSave`, `undeclaredActionRefusalAtRun` and `undeclaredActionRefusalReasonAtRun` (`data`); `@objectstack/runtime` adds no export: the action body runner answers through `resolveActionRefusal` internally. Nothing that was accepted before is refused
Metadata-protocol: added
Skills-docs: follow-up #34824 — `skills/objectstack-i18n/SKILL.md` lists the hook refusal key only and `skills/objectstack-ui/rules/actions.md` teaches no action `refusals`; `content/docs/ui/actions.mdx` and `content/docs/ui/translations.mdx` gain the section and the key row here

A `script` action's `js` body can now refuse the way a hook does: declare the refusals it may throw, keyed by code, and throw the code instead of the sentence — `refusals: { NOT_DRAFT: { message: 'Only a draft invoice can be signed off.', status: 409 } }`, then `throw { code: 'NOT_DRAFT' }`. The server answers with the entry's sentence in the caller's locale (the request's `executionContext.locale`), else the declared one, on the refusal's `userMessage`, with the entry's status (400 when it names none). The entry is the hook catalogue's, built by one shared factory: optional `reasons` (further sentences under one code) and `params` (the names a `{{ }}` hole may fill), under the same rules.

- The translation sits beside the action's other copy: `objects.<object>._actions.<action>.refusals.<CODE>.message` for an action bound to an object, `globalActions.<action>.refusals.<CODE>.message` for an object-less one. `os i18n extract` scaffolds the keys and the coverage check counts them; `objectstack validate` refuses a translation over a code or reason the action does not declare.
- A code the catalogue does not declare, a reason a code with `reasons` does not declare, or a throw with no code is refused: at save when the body names it literally, otherwise when it runs, as a fault naming the action and the code. An error a `ctx.api` call raised and the body let through unchanged passes through as before, and so does a crash.
- `refusals` is read only for a `type: 'script'` action with a `js` body (an inline `target` function is lowered to one by `os build`); on any other action, or with no body, it is refused at save.
- A sentence with `params` is compiled like a hook's: `objectstack validate`, `compile` and the publish gate refuse a hole holding logic, an unknown formatter, an empty hole and `{{ amount | currency }}` with no code.
- An action without `refusals` is answered exactly as before.

The shared declared-entry factory (`packages/spec/src/data/declared-entry.zod.ts`) now builds `HookRefusalSchema`, `ActionRefusalSchema` and `HookTextSchema`; the published hook schemas are unchanged.

`@object-ui/core` lists `refusals` among the spec's declared action keys, so an action carrying a catalogue is not reported as having an unknown key; the console reads nothing new, because the refusal arrives already rendered on `userMessage`.
