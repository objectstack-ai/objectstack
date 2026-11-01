---
'@object-ui/plugin-form': patch
---

fix(plugin-form): a keystroke in a master-detail header is no longer dropped while the page has other work pending

Clause-②: no
Metadata-protocol: none

A master-detail form (`object-master-detail-form`, `MasterDetailForm`) could lose what the user typed into a header field. The form host listens to the header's `input` events to feed the line grids' `parent` record, and that listener runs before React has passed the keystroke to the header form. Its state update ran at sync priority, so the browser flushed it right there together with any default-priority work the page had pending, such as a fetch that had just answered. That render drew the header input again with its old value, React then saw no change, and the keystroke never reached the form. The field showed the text for a moment and went blank, and Create was refused with "is required" for a field the user had filled.

The line grids now take the header edit as a transition, which the browser does not flush at that point, so the header form always reads the keystroke first. The lines still follow the header: a `readonlyWhen: "parent.status == 'paid'"` cell locks as soon as the header says paid.
