---
'@objectstack/service-storage': patch
---

feat(service-storage): the upload-link page names the record and the field for the link's own user, and shows the expiry in the reader's time zone

Clause-②: yes (widening)
Metadata-protocol: none

The page an upload link opens (`GET /api/v1/storage/upload-links/:token`, handed out by MCP `create_upload_link`) now shows two rows for the signed-in user the link was made for: `Record` (the object's label and the record's title, for example `Expense "Taxi 11-12"`) and `Goes into` (the field's label, or `Attachments`). A link for a record not yet created shows the object's label and the field. Every name is read as that user when the page opens, through the same record read and the same field-level answers their own read gets, and in the page's language. A title the user is served masked or cannot read is left out and the row shows the object's label only; a field they cannot read loses its row. The page never shows an id, an API name, a user or an organization, and the browser tab title stays generic. A record the user can no longer read gets the same 404 page a used, expired or someone else's link gets.

The expiry is rewritten in the reader's own time zone, and once it has passed the page says the link has expired and disables Send, judged on the server's clock. The server's single refusal for an unusable link is unchanged.
