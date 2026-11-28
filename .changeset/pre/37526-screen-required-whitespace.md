---
'@objectstack/spec': patch
'@objectstack/service-automation': patch
'@objectstack/runtime': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(automation): a screen flow refuses a required field holding only spaces at the field, and an engine screen refusal reaches the user in their language, at the field it names

Clause-②: yes (widening)
Metadata-protocol: none

A required text field on a flow screen that held only spaces passed the screen dialog's check. The server trims, so it refused the submission, and the dialog showed the server's sentence as it was: English in every language, listing the screen's API field names (`Invalid screen input: Screen field "resolution" is required — declared fields: 'resolution', 'resolved_by_article'`).

Now the dialog counts a value of only spaces as no answer, as the server does, and refuses it under the field with the same message an empty field gets, in the user's language. Nothing is sent.

When the server still refuses a screen's values, `400 INVALID_SCREEN_INPUT` now carries its findings in `error.details.fields`: one `{ field, code, message }` entry per violated field, with an ADR-0114 field code, the same entries a `VALIDATION_FAILED` carries. `AutomationResult` gains the optional `fields` the engine fills them from, mirrored on `TriggerFlowResponseSchema`. `error.message` is unchanged. The Console's flow runner marks each field it names, by its label and in the user's language, moves focus to the first, and its banner reads "Some values on this step weren't accepted. Check them and try again." instead of the server's sentence, also against a server that sends no findings. Nothing to migrate: a client that reads only `error.code` and `error.message` sees what it saw before.
