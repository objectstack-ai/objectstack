---
'@object-ui/components': patch
---

fix(components): a record header action shows that its click is in flight

Clause-②: no
Metadata-protocol: none

A click on a slow header action, such as a flow-backed Convert Lead whose screen dialog waits on a network launch, used to leave the button live and unchanged until the dialog or result arrived, so users clicked again. While the click's promise is pending, the button is now disabled and `aria-busy`, a spinner replaces its icon, and further clicks do nothing. It returns to normal when the promise settles, on success or failure. The same applies to the phone bottom-bar face and to `⋯` overflow items, which share the renderer. A click that returns no promise is never busy. A host `onClick` that rejects is now reported with `console.error` naming the action, where it used to surface as an unhandled rejection.
