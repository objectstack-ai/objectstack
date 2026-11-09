---
'@object-ui/fields': patch
'@object-ui/plugin-detail': patch
'@object-ui/plugin-grid': patch
---

fix(ui): Setup record pages name a sharing rule's recipient and read its condition in words, and the audit list names a sign-in row's session by its user

Clause-②: no
Metadata-protocol: none

- **`@object-ui/plugin-detail`.** The record page's highlights strip and details body hand each read face the record as `dependentValues`, as a list grid hands its row. A `recipient-picker` value is an id that means something only beside its `recipient_type`, so a sharing rule's page read the stored user id under 接收方 where its list read the user's name; it now reads the name.
- **`@object-ui/fields`.** `widget: 'filter-condition'` has a read face of its own: a list or detail cell draws the criteria through the widget's read-only display, which says it in the object's field and option labels ("Priority equals Urgent"; an OR group joined by its word, a boolean as a word). A criteria the builder cannot represent still reads as the stored JSON, and an empty one is the empty cell. A read-only widget no longer waits for its `object_name` to say anything: without it, the fields keep their api names.
- **`@object-ui/plugin-grid`.** A pointer cell (`referenceVia`) reads the target record with its name field expanded when that field is a reference the viewer may read, so a record named by a lookup reads as the referenced record's name: the audit list's sign-in rows name the session by its user instead of printing the user id. Any other name field is read as before, with no `$expand`.
