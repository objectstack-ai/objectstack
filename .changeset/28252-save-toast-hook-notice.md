---
'@object-ui/data-objectstack': patch
'@object-ui/react': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-form': patch
'@object-ui/plugin-grid': patch
---

feat(console): a save's toast shows the notice a hook set on the write, still one toast per write

Clause-②: yes (widening)
Metadata-protocol: none

A create or update answer can carry a `notice`: one message a hook on the write set for the person who made it, such as "Sent to your manager for approval". The Console now shows it. The record form's save toast (the record dialog, its child-form task and the full-page form), the `object-form` drawer and modal, and the grid's inline-edit saves (the per-row save and "Save All") keep their own message as the title and show the notice under it. The toast stays a success when the notice is the only news, and moves to the warning variant, with the notice leading the lines, when the answer also carried warnings. A write no save surface reports itself, such as the record page's inline edit Save bar, gets one toast from the write-warning channel instead: an info toast with the notice as the hook wrote it, or the notice leading the "Saved — with warnings" lines.

- **`@object-ui/data-objectstack`**: `WriteWarningEvent` gains an optional `notice`, read off the single-record create and update answers. The event is now also emitted when the notice is the answer's only news. What `create` and `update` resolve is unchanged.
- **`@object-ui/react`**: new type `RecordSaveFeedback` (`warnings`, optional `notice`). `AnswerWarningClaim.take` returns it, `AnswerWarningsEvent` gains `notice`, and `toastRecordSave` takes it as its third argument. These exports have not been released yet, so no released signature changes.
