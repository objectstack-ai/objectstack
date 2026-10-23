---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a publish build probe refused by read admission tells the publisher to get read access, not to change a correct dataset

Clause-②: no
Metadata-protocol: none

The dashboard-widget probe runs the widget's dataset query as the publishing caller. A publisher who may not read the dataset's object got a `widget_query_failed` issue whose `fix` said to fix the dataset definition so the query compiles. The dataset was correct; the cause was the publisher's read access.

- **An access refusal names the access.** When the analytics service refuses the query with `PERMISSION_DENIED` (an object or a field the caller may not read), the `fix` now says the dataset is not the cause, and that the publisher (or the role the dashboard is for) needs read access to the refused object, and the refused fields when the refusal names them. The refusal is told apart by the error's code, not its message.
- **Every other failure keeps the dataset fix.** A selection the dataset does not declare, and a member the field-level gate cannot judge (also `PERMISSION_DENIED`, but its remedy is a dataset change), keep "Fix the dataset definition (or the widget's values/dimensions) so the query compiles, then republish."
- **Nothing else changes.** The issue's `code` (`widget_query_failed`), `severity` (`error`) and `message` are the same, and so is every other probe plane.
