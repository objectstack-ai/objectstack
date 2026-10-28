---
'@objectstack/service-print': patch
---

feat(service-print): a record prints on any print page of its object, not only on the default record page

Clause-②: yes (widening)
Metadata-protocol: none

`printRecordToFile` (and `POST /api/v1/print/records`) used to refuse every page that was not the object's default record page (`VALIDATION_ERROR` / 400), so an app that printed an object had to turn that object's everyday record page into the printed document. A record now prints on any record page of its object that declares `print`:

- **The default record page** (`isDefault: true`) renders on the console's record route, `CONSOLE/apps/APP/OBJECT/record/ID`, as before.
- **Any other print page** renders on the console's named record-page route, `CONSOLE/apps/APP/OBJECT/record/ID/page/PAGE`, which draws that page and never falls back to the default one. An object keeps its working record page and adds its documents (an invoice, a quote, a delivery note) beside it.

Two refusals remain, both `VALIDATION_ERROR` / 400 before anything is minted or rendered: the page is not a record page of the object, and the page declares no `print`. "A record page of the object" is the console's own reading (`type: 'record'` and that `object`), so the server prints exactly the pages the console's named route draws. An unknown page name is still `RESOURCE_NOT_FOUND` / 404. No metadata key is added or changed: the request already names its page.
