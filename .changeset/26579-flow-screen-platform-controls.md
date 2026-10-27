---
'@object-ui/app-shell': patch
---

fix(app-shell): flow screen date, date-time and boolean fields use the platform controls

Clause-②: no
Metadata-protocol: none

A screen flow's input screen was the last form surface still drawing the browser's native date input, so a `date` field showed the machine's format (`mm/dd/yyyy` under a Chinese console), a `datetime` field was a bare text box, and a `boolean` field was a lone checkbox on the line under its label, which read like an empty radio button.

What changes:

- A `date` or `datetime` screen field is now the record form's date picker: a text box in the display locale's format, a calendar popover, a clear button and the today / tomorrow shortcuts. The value it hands the flow is the stored shape: `YYYY-MM-DD` for a date and an ISO instant for a date-time, and `''` when cleared, as the native date input wrote.
- A `boolean` (or `checkbox`) screen field is now the inline row the action-parameter dialog draws: the checkbox with its label beside it, and the help text under the row.

What to do: nothing. No flow metadata changes.
