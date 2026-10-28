---
'@object-ui/app-shell': patch
---

fix(app-shell): the screen-flow dialog refuses an empty required field at the field, as the record form does

Clause-②: no
Metadata-protocol: none

Submit on a flow screen with a required field left empty used to answer with one toast naming the fields and nothing in the dialog, so it read as a button that did nothing. Each missing field now shows "FIELD is required" under its control, the control is marked `aria-invalid` and names the message in `aria-describedby`, focus moves to the first missing field, and Submit stays. No toast is raised and no resume request is made, matching the record form. Editing a field clears its message. A retryable refusal from the engine keeps the screen, the typed values and Submit as before; a run the engine has already ended still offers only Close.
