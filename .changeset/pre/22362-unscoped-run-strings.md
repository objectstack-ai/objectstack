---
'@objectstack/service-automation': patch
'@objectstack/objectql': patch
---

fix(service-automation, objectql): the `runAs: 'user'` refusals and the run-setup warning say what a principal-less operation meets on both kernels

Clause-②: no

Three author-facing texts told a flow or hook author that a `runAs: 'user'` data operation with no trigger user "would execute UNSCOPED (elevated, RLS-bypassing)" if it were not refused. That holds only on a kernel with no security plugin. Since ADR-0096 D5, a kernel with `@objectstack/plugin-security` refuses an operation that carries no principal (`403 PERMISSION_DENIED`). Each text now says both: without a user the operation would carry no principal, refused by the security plugin where one is composed, unscoped where none is.

- `@objectstack/service-automation`: the `UnscopedRunDataAccessError` message, and the `[runAs]` warning logged at run setup for a flow whose trigger resolved no user.
- `@objectstack/objectql`: the `HookUnscopedDataAccessError` message.

Only the wording changes. The refusals, their order, their codes (`AUTOMATION_UNSCOPED_RUN_DATA_ACCESS`, `HOOK_UNSCOPED_DATA_ACCESS` with its `403` status) and their remedy are unchanged: declare `runAs: 'system'` to make the elevation explicit and intended, or arrange for the trigger to supply a user.
