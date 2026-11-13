---
"@objectstack/mcp": patch
"@objectstack/service-storage": patch
---

Clause-②: no
Metadata-protocol: none

`create_upload_link`'s description now says which link each refusal applies to: a field link gets no link for a read-only field (`readonly`, or a `readonlyWhen` that holds on the record now) or for a record a pending approval locks, while an attachments link asks only what attaching asks, so a locked record still takes attachments. The upload-link page and upload doors now answer a refusal's `error.code` from the closed ADR-0112 vocabulary: a producer's unregistered spelling is answered as the code its status derives, with the spelling beside it as `declaredCode`, as the upload commit door already answers it.
