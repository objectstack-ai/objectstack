---
'@object-ui/types': patch
'@object-ui/core': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-grid': patch
'@object-ui/i18n': patch
---

feat(console): a bulk result names the records it wrote, and a required-field refusal says what to fill in

Clause-②: yes (widening: `ActionResult` gains the optional `fieldErrors` member, `ActionFieldError` is a new export of `@object-ui/types`, and `ActionResponseOutcome` gains `fieldErrors`; no accept set moves)
Metadata-protocol: none

- **Bulk action result.** After a bulk action such as Mark Done, the result read only "Succeeded 2 / 2". It now lists the records that succeeded, named the way the confirm step names them (the object's name field). The list appears when every failure is reported against a record of the run; when the server answered a bare count, the result keeps to the count rather than name a record that may have failed.
- **Required-field refusal from an action.** Running an action whose write the server refuses for a missing required field, such as Submit for Sign-off on a draft invoice with no Issued On, used to say only "Issued On is required". It now continues "Fill in Issued On, then run “Submit for Sign-off” again." Several fields are joined in the session's language. Any other refusal is shown as the server wrote it.
- For code that dispatches actions through `createServerActionHandler`: a failed `ActionResult` now carries the refusal's per-field entries as `fieldErrors` (field, code, message, label), read from the answer's `error.details.fields`. `error` is unchanged.
