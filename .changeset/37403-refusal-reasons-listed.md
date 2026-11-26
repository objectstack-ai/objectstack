---
'@object-ui/types': patch
'@object-ui/core': patch
'@object-ui/app-shell': patch
---

feat(console): a refusal that names several reasons lists every one in its alert box

Clause-②: yes (widening)
Metadata-protocol: none

The widening: `@object-ui/types` adds the export `ActionRefusalLine` and the optional member `ActionResult.refusals`, and `@object-ui/core` adds the optional member `ActionResponseOutcome.refusals`. Nothing is narrowed; every package ships `patch`.

- **Every reason is shown.** When a refusal names several reasons (the server answers each reason's sentence on `error.details.refusals`), the action dialog's refusal box lists every reason in the order the server sent them, then the refusal's closing sentence, with no "More" toggle hiding any of them. A refusal without such a list renders as before.
- **The reasons come from the list, not from the text.** The closing sentence is read from the end of the refusal text only when that text still starts with exactly the listed reasons; when the text was cut short, every reason is still shown and the closing sentence is left out.
- **New: `ActionResult.refusals`** (`@object-ui/types`, with its element type `ActionRefusalLine`) **and `ActionResponseOutcome.refusals`** (`@object-ui/core`): the reasons a failed result's refusal listed, read from the `/actions` response by `interpretActionResponse` and set by the server action handler beside `userMessage`. `RefusalMessage` (`@object-ui/app-shell`) takes them as `lines`.
