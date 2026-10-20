---
'@objectstack/runtime': patch
---

fix(runtime): two hand-built 400 refusals now put an ADR-0114 `FieldErrorCode` catalog member on `details.fields[].code` instead of a Zod issue code (#24597)

Clause-②: no

`FieldErrorCode` is a closed catalog: a service may not invent a field code. Two refusals built their `details.fields[]` rows by hand and wrote Zod's issue code there instead of a catalog member:

- **The run-lifecycle body refusal** on `POST /api/v1/automation/:name/runs/:runId/cancel` and `POST /api/v1/automation/:name/runs/:runId/restore-suspension`. For an unknown body key, the row's `code` changes from `unrecognized_keys` to `unknown_field`. `unknown_field` is the code the `resume` door on the same run already answers for an unknown key.
- **The permission-set clone door's name rule** on `POST /api/v1/security/permission-sets/:name/clone`. For a `name` that is not lowercase snake_case, the row's `code` changes from `invalid_string` to `invalid_format`.

What changes on the wire: a client that switched on `details.fields[].code` sees `unknown_field` where it saw `unrecognized_keys`, and `invalid_format` where it saw `invalid_string`. Both are members the published catalog already declares. Nothing else changes: each refusal keeps its status (400), its `error.code` (`VALIDATION_FAILED`), its message and its rows' `field` and `message`. No body is accepted or refused that was not before, and no catalog member is added.
