---
'@objectstack/objectql': patch
---

`skipAutomations` no longer skips ObjectQL's own audit stamps: a data import with "run automations & triggers" unchecked stamps `created_by` / `updated_by` from the session user again

Clause-②: no

`ExecutionContext.skipAutomations` suppresses the lifecycle hooks bound from metadata and, by its own
description, never bypasses audit. ObjectQL's builtin audit stamps (`sys_stamp_audit_insert` on
`beforeInsert`, `sys_stamp_audit_update` on `beforeUpdate`) were registered through the hook binder,
so they carried the metadata binding the opt-out keys on and were skipped together with the app's
hooks. Rows that a data import wrote with automations off landed with no `created_by` / `updated_by`
and no value in a declared plain `tenant_id` field. On a driver that does not stamp its own
timestamps, they also landed with no `created_at` / `updated_at`. The organization column was not
affected: the driver stamps it from the engine's driver options either way.

The builtins are now registered in code (`registerHook`, no metadata binding), which is how the
contract describes audit. They run under `skipAutomations` exactly as they run without it, and they
keep the same wrapper, priority and `sys:audit` package id. Every hook bound from metadata is still
skipped under the flag. ⛔ Nothing you author changes: no key, option, export or type is added or
removed.
