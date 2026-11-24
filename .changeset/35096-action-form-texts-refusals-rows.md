---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

feat(spec): the Studio action form offers an action's declared `refusals` and `texts`

Clause-②: no
Metadata-protocol: none

- **Studio action form.** `actionForm` gains two rows in the Behavior section, right after the script `body`, each shown only on a `type: 'script'` action as the body is: `refusals`, a key-only record keyed by the SCREAMING_SNAKE code the body throws, each entry editing its `message`, `status`, `reasons` (a key-only record of `{ message }`) and `params`; and `texts`, a key-only record keyed by the snake_case key the body asks for with `ctx.text`, each entry editing its `message` and `params`. They are the hook form's two rows, because the action entries are the hook entries. An author editing an action in the Studio can now write the `refusals` and `texts` the schema already accepts, instead of going through the metadata API or the package source. Nothing about what an action may declare changes.
- **Locale packs.** The rows' labels and help text ship in all eleven metadata-forms locale packs of `@objectstack/platform-objects`.
