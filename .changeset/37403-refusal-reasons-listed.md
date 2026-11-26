---
'@object-ui/types': patch
'@object-ui/core': patch
'@object-ui/app-shell': patch
---

feat(console): a refusal that names several reasons lists every one in its alert box

Clause-②: no
Metadata-protocol: none

- **Every reason is shown.** When a refusal names several reasons (the server answers each reason's sentence on `error.details.refusals`), the action dialog's refusal box lists every reason in the order the server sent them, then the refusal's closing sentence, with no "More" toggle hiding any of them. A refusal without such a list renders as before.
- **The reasons come from the list, not from the text.** The closing sentence is read from the end of the refusal text only when that text still starts with exactly the listed reasons; when the text was cut short, every reason is still shown and the closing sentence is left out.
- **New: `ActionResult.refusals`** (`@object-ui/types`, with its element type `ActionRefusalLine`): the reasons a failed result's refusal listed, set by the server action handler (`@object-ui/core`) beside `userMessage`. `RefusalMessage` (`@object-ui/app-shell`) takes them as `lines`.
