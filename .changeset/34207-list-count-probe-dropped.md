---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(app-shell): an object list page reads its object once per load

Clause-②: no
Metadata-protocol: none

An object list page sent two reads of its object on every load: the list's own `GET data/OBJECT?top=50&…` and a `GET data/OBJECT?top=0` record-count probe, and the probe was sent again on every refresh. The probe's number fed a page-level count that nothing drew any more. The footer it once fed was retired with the split pane, and the one panel prop it still reached was never read. The record-count bar under the list and the view count in the title both take the `total` from the list's own answer, which carries the view's filters and search. The probe is gone, so a list page load sends one `data/OBJECT` read, and a refresh sends one. The numbers on the page do not change.
