---
'@objectstack/service-datasource': patch
---

fix(service-datasource): the credential migration's drop-inline refusal names an empty stored credential as empty

Clause-②: no
Metadata-protocol: none

When a datasource already references a stored secret that decrypts to an empty value (a row sealed empty before the admin doors refused an empty `secret`), the credential migration still refuses to drop the inline copy, with the same `refused` status, but its reason now says the credential is empty, in the connect path's wording, instead of blaming a missing `sys_secret` row or a changed encryption key. A missing row or a decrypt failure keeps its sentence.
