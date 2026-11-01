---
'@object-ui/components': patch
'@object-ui/i18n': patch
---

feat(components): the edit form names the fields a visible update action would require, before the action is pressed

Clause-②: yes (widening: `@object-ui/i18n` gains the `form.requiredForAction` key in all ten locales; no accept set moves)
Metadata-protocol: none

A declarative update action (`operation: 'update'` with a static `patch`) writes its patch over the record, and the server runs the object's `requiredWhen` rules over the result. The edit form judged the record as it stands, so a field that only the action makes required showed nothing, and the first press was refused. In the showcase, "Issued On" on a draft invoice is required once `status` is `sent`, and "Submit for Sign-off" sets `status: 'sent'`.

The form renderer now reads the object's declared actions on an edit form, through the data source it already has. For each update action that is placed, not switched off, permitted and visible for the record, it evaluates each field's `requiredWhen` over the record merged with the patch. An empty field that comes out required shows "Required to run “Submit for Sign-off”." under the control, inside the description the control's `aria-describedby` names.

- It is a heads-up only. Save is not blocked, and the field is not marked required for Save. The server's refusal stays the source of truth.
- Actions that collect `params`, and actions whose write is not a static `patch`, are skipped, because what they write is not known before they run.
- A create form reads and marks nothing.
