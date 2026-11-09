---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): a refused `targetNamespace` on an unmanaged install answers `400 INVALID_REQUEST` with the reason, as documented

Clause-②: no
Metadata-protocol: none

An unmanaged install whose `targetNamespace` the namespace rule refuses (`Acme`, `my-ns`, too long), or that names a shared namespace (`base`, `system`, `sys`), was refused with a 400 that carried no code. The boundary answered it as `VALIDATION_ERROR`, and the install-local door (`POST /api/v1/marketplace/install-local`) withheld the reason, answering only that it was in the server log.

Both refusals now answer `400 INVALID_REQUEST`, the code the install-modes guide and the other rename refusals already give, with `details.targetNamespace`. Through the install-local door the answer now carries the reason, for example `Invalid package namespace 'Acme' on targetNamespace. ...`. Nothing else changes: the refusal still comes before anything is written, and a `targetPackageId` the id rule refuses still answers `VALIDATION_ERROR`.
