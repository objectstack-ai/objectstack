---
'@object-ui/app-shell': patch
---

Clause-②: no
Metadata-protocol: none

An app whose navigation holds only `doc` entries now opens its first doc in the in-app docs portal, instead of an empty page (#29678).

- The app root still opens the declared landing first, then the first object, page, dashboard, report or component entry the member is shown. Only when none of those lands does it open the first `doc` entry the member is shown, groups included.
- An app whose first entry is a doc, followed by working entries, opens on its first working entry, as before.
- The doc is gated as a declared `doc` landing is: by the server's audience gate on the app and doc reads.
- The app designer's preview names that doc as the app's landing, as the console does.
