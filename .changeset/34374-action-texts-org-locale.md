---
'@objectstack/spec': minor
'@objectstack/runtime': minor
'@objectstack/lint': minor
'@object-ui/core': patch
---

feat(actions): an action writes the sentences it declares in the organization's language

Clause-②: yes (widening: a new optional authorable key `ActionSchema.texts`, and new translation keys)
Metadata-protocol: added
Skills-docs: follow-up owed — skills/objectstack-ui/rules/actions.md, skills/objectstack-i18n/SKILL.md

A `script` action's `js` body can now write a sentence into a record in the organization's language, the way a hook does: declare it under `texts`, keyed by a snake_case key, and ask for it by key — `texts: { email_subject: { message: 'Email: {{ subject }}', params: ['subject'] } }`, then `await ctx.text('email_subject', { subject })` where the body used to write `'Email: ' + subject`. The answer is in the organization's language, because everyone in the organization reads the record: the Localization setting (`localization.locale`) when somebody set it, else the app's declared `i18n.defaultLocale`. It is never the language of the person who ran the action. The translation is picked first, then its `{{ }}` holes are filled from `params`. The entry is the hook text's, built by the same shared factory.

- The translation sits beside the action's other copy: `objects.<object>._actions.<action>.texts.<key>.message` for an action bound to an object, `globalActions.<action>.texts.<key>.message` for an object-less one. `os i18n extract` scaffolds the keys and the existing coverage check counts them; `objectstack validate` refuses a translation over a key the action does not declare.
- A missing translation, or no language to pick, answers the declared sentence, and the action goes on. A Localization setting that cannot be read rejects the call.
- Only declared text is translated: a string the body builds itself is written as it is. A key `texts` does not declare is refused when the action is saved if the body asks for it literally (`ctx.text('key')`), otherwise when it runs, as a fault naming the action and the key.
- `texts` is read only for a `type: 'script'` action with a `js` body (an inline `target` function is lowered to one by `os build`); on any other action, or with no body, it is refused at save. A `flow` action's record writes are the flow's own, marked and translated there (`flows.<flow>.records.…`).
- A text with `params` is compiled like a hook's: a hole over another name is refused when the action is saved, and `objectstack validate`, `compile` and the publish gate refuse a hole holding logic, an unknown formatter, an empty hole and `{{ amount | currency }}` with no code. A translation whose holes do not render at run time is dropped for the declared sentence, filled.
- Text is picked when it is written. Records already written are not changed. An action without `texts` runs exactly as before.

`@object-ui/core` lists `texts` among the spec's declared action keys, so an action carrying them is not reported as having an unknown key; the console reads nothing new, because the body stores the sentence already picked.

New exports: `@objectstack/spec` adds `ActionTextSchema` and the `ActionText` type (`ui`), `actionTextMessageKey` (`system`), and `ACTION_TEXT_MESSAGE_HOLE_REFUSED`, `actionTextsWithoutRunnableCode`, `undeclaredActionTextKeyAtSave` and `undeclaredActionTextAtRun` (`data`); `@objectstack/runtime` adds none. Nothing that was accepted before is refused.
