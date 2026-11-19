---
'@object-ui/react': patch
---

fix(react): a print page is never the record page an object falls back to

Clause-②: no
Metadata-protocol: none

A print page is no longer the record page an object falls back to. When an object has no `isDefault` record page, the console's record route used to open the first record page of the object in declaration order, so an app that authored only a print page for an object (a quote, a contract) opened every record as that printed document, with no path, tabs, related lists or edit flow. The fallback now skips pages that declare `print`: the first record page that does not print opens, and with none the record route draws the synthesized default record page. A print page still opens on the named record page route, and where its author declares it the object's default record page (`isDefault`) or scopes it to an app (`apps`).
