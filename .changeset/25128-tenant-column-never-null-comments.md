---
'@objectstack/spec': patch
---

docs(spec): the `systemFields` docblock no longer says `organization_id` stays NULL on single-tenant stacks

Clause-②: no (comment and docblock text only: no accept set, response, status, error, outcome or export moves)
Metadata-protocol: none

The `organization_id` bullet of `ObjectSchema`'s `systemFields` docblock now says what the runtime does: org-scoping stamps the tenant column on insert (under `single` with the Default Organization), and it is never NULL (ADR-0131 D1). Only the column's index is still gated on multi-tenant mode. No schema, `.describe()` text or behavior changes.
