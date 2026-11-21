---
'@object-ui/components': patch
'@object-ui/app-shell': patch
'@objectstack/plugin-approvals': patch
---

fix(console): the approval request page is named by the record it asks a decision on, and its reject button no longer outweighs approve

Clause-②: yes (widening)
Metadata-protocol: none

- **The page title.** An approval request's page used to be titled by its flow's label ("Purchase approval"), which the strip under it repeated as its Flow chip, while the business record the approver decides on had no title at all. The page header now reads the record's title the approvals get serves (`record_title`), linked to that record once the page itself has read it: a plain click opens it in the app, as the "As submitted" card's "Open record" link does, and a modifier or middle click opens it in a new tab. Where the page's read of the record is refused or finds nothing, or the platform says the record was deleted, the title is plain text with no link, as the record card on the same page draws it. The title makes no read of its own: the reads the page already makes report what they found. Where the get serves no title for the record, or serves only its id, the header keeps the flow's label, so the page never names the record by a raw id. The flow stays named once, by the strip's Flow chip; no subtitle is added, because it would repeat that chip. The request object's declared title (`nameField: 'process_label'`) is unchanged, so lists, search, recent items and the breadcrumb still name a request by its flow.
- **`RecordHeaderState.title`** (`@object-ui/components`, new optional member, with its type `RecordHeaderTitle`). A host that knows a better name for the record than the object's declared title hands `{ text, node? }`; `page:header` draws `node` (or `text`) inside its H1, in the host's top bar and in its own row alike. Absent, or with an empty `text`, the header's own title stands exactly as before.
- **The decision band.** In the approver's band (the request page, and the business record page's approval band), Approve stays the filled primary button and Reject is drawn as an outline button in the destructive text colour, the face the record header already gives a secondary danger lever. A host that does not ask for the band's fold keeps the declared filled danger face.
- **One time format.** The approval timeline's action times use the compact datetime face the page's highlight chips and every `datetime` cell draw (`2026/11/10 下午8:25` under zh-CN), in the host's display time zone, instead of the browser's long form with seconds.
- `@objectstack/plugin-approvals`: comments only, saying where the request page now names its record.
