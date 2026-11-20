---
'@objectstack/rest': patch
'@object-ui/plugin-detail': patch
---

feat(rest): a refused cross-object batch names the operation that caused it, and a related list's multi-pick add names that record

Clause-②: yes (widening)
Metadata-protocol: none

`POST {basePath}/batch` (the cross-object transactional batch) now adds `failedOperation: { index, object }` to its refusal body when one operation is the cause: `index` is that operation's position in the request's `operations`, and `object` is the object it named. It rides beside the existing `error`, `code` and `userMessage`. It is present when an `update` or `delete` op is refused up front for naming no row (`400 VALIDATION_FAILED`), and when an op fails while the transaction runs (for example `404 RECORD_NOT_FOUND`, a `400 VALIDATION_FAILED` validation refusal, `400 BATCH_UNRESOLVED_REF`, `409 RESOURCE_CONFLICT`). It is absent when the request as a whole is refused (schema, `atomic: false`, size, no transaction), on the per-object API exposure and API-key management refusals, which are judged once per object and action, and on a failure after the last op ran.

The key is additive. The success body does not change, and the batch stays all or nothing: a refused batch writes no row. Through `@objectstack/client` the key reaches `err.details.failedOperation`, because the client hands a flat refusal body with no `details` of its own over as `err.details`. A refusal that carries its own `details` (a package-scoped `409 RESOURCE_CONFLICT` with `details.candidates`) still carries the key on the body, but the client exposes only its `details` there.

The related list's "Add" picker (`@object-ui/plugin-detail`) uses it: when a multi-pick add is refused for one picked record, the inline error names that record by the label the picker shows, followed by the server's reason. A refusal without an index inside the operations sent shows the server's reason alone, as before.
