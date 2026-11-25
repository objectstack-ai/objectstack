---
'@object-ui/fields': patch
---

fix(fields): a click in a record form's date box opens the calendar

Clause-②: no
Metadata-protocol: none

On a record form, and in the dialogs that reuse the same date and date-time widget, the calendar opened only from the small calendar button at the right of the box; a click in the box itself put a text cursor there and nothing else, and users took the field for broken. A click in the box now opens the same calendar popover. The box keeps the focus, so typing a date still works: the text is read on Enter or when the box loses focus, as before, and Enter also closes the popover. Escape closes it and leaves the focus in the box. Focus that arrives by Tab opens nothing, so tabbing through a form does not pop a calendar at each date field. The calendar button works as before. The box now carries the popover relationship the button carries (`aria-haspopup="dialog"`, `aria-expanded`, `aria-controls`). The grid's in-cell date editor, which already shows the calendar beneath the box, is unchanged, and the value written is unchanged.
