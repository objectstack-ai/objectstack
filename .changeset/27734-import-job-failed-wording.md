---
'@objectstack/spec': patch
---

docs(spec): `ImportJobStatus` and `ImportJobProgressSchema.error` describe `failed` as the REST server now ends it: a job aborted on a fatal error, or a job whose every row failed (#27734)

Clause-②: no
Metadata-protocol: none

Only the declared meaning changes; no enum value, key, type or export does, and the wire is unchanged.

- **`ImportJobStatus`.** `failed` covered only a job aborted on a fatal error. Since the async import worker in `@objectstack/rest` ends a job that had at least one row and created, updated or skipped none of them `failed` (maintainer ruling B, record 6509036166), the docblock and the value comments say so. `succeeded` still covers a job with no rows, a job whose every row was skipped and a job whose rows only partly failed; a dry run follows the same rule. A cancel wins over that counting rule, so over both of its outcomes, but not over a fatal abort: an error thrown after the job was cancelled still ends it `failed`.
- **`ImportJobProgressSchema.error`.** Described as the fatal error only; it now also says that, when every row failed, it carries one sentence pointing at the job's `results`, which hold each row's reason. The reference page `api/export` is regenerated from it.
