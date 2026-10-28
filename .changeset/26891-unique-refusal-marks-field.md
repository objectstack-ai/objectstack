---
'@object-ui/react': patch
---

fix(react): a create or edit form marks the field a unique-index refusal names

Clause-②: no
Metadata-protocol: none

Saving a record whose value collides with a unique index (a product SKU, an account name that must be unique) used to show "A record with this value already exists" as a banner and a toast, with no field marked. The user had to guess which of the form's unique fields collided.

The server's `409 UNIQUE_VIOLATION` answer names the one field on `field`, with a sentence that names it by its label ("A record with this SKU already exists"). `extractFieldErrors` only read lists of field errors, so it answered nothing for this refusal. It now returns one entry for it: the named field, carrying the server's sentence. The form renderer writes that sentence under the input, as it does for a `required` field, and shows no banner. Inline edit on a record page reads the same helper, so its save bar attributes the refusal to that field too.

When the server cannot tell which column collided (an index name, a composite key), the answer has no `field` and nothing changes: the banner stays.

What to do: nothing.
