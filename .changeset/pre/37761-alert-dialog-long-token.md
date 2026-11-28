---
'@object-ui/components': patch
---

fix(components): a long unbroken token in an alert dialog's title or description no longer stretches the dialog past the viewport

Clause-②: no
Metadata-protocol: none

The record delete confirm puts the record's title in the alert dialog's title. A title holding one long token with no spaces (a pasted URL, a file name, a hash) set the width of the dialog's grid track, so the dialog grew past `max-w-lg` and the right-aligned Cancel and Delete buttons moved off-screen, reachable only from the keyboard. The shared `AlertDialogContent` now lets its grid items shrink below their min-content width, and `AlertDialogTitle` and `AlertDialogDescription` break such a token (`overflow-wrap: anywhere`). Every alert dialog is covered; a caller's own classes still merge as before.
