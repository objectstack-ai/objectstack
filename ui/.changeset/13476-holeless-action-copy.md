---
"@object-ui/core": minor
---

Clause-②: no
Metadata-protocol: narrowed

An action's `confirmText` or `successMessage` with no `{{ }}` hole is now shown exactly as written (objectui#13476).

objectui#13367 kept one transitional reading: a sentence with no `{{ }}` hole still had its `${…}` tokens filled, `${record.*}` in the confirm dialog and `${result.*}` in the success toast. That reading is gone. A `${…}` token in either text is now plain text, the same as in any other copy with no hole. To put a value into the sentence, write a `{{ }}` hole: `Archive {{ record.name }}?`, `Invitation sent to {{ result.email }}`.

No in-tree producer writes the holeless `${…}` shape. objectstack's measurement of its examples, `platform-objects`, `plugin-approvals` and HotCRM found none. objectstack's lint already warns on the shape and refuses every other `${…}` token in this copy (objectstack#25702). The paired objectstack card turns the warning into an error once its objectui pin carries this change.

`outcomeMessages` entries are unchanged: they still fill `${result.*}`. `errorMessage` is unchanged: it is shown as written.
