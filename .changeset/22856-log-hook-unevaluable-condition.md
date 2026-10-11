---
'@objectstack/objectql': patch
---

A write refused because an `after*` hook's `condition` could not be evaluated no longer leaves its row behind when that hook is `onError: 'log'` or `async: true`

Clause-②: no

A hook `condition` that cannot be evaluated aborts the operation whatever the hook's `onError` says. Examples are a condition reading `previous` on an insert, a key the object does not declare, or `null > null`. The condition is checked before an `async: true` hook detaches, so that hook aborts too. The write door rolled the write back only for a blocking `onError: 'abort'` hook. So an `afterInsert` / `afterUpdate` / `afterDelete` hook marked `onError: 'log'` or `async: true` refused the caller while the row stayed stored, changed or deleted. Measured on REST `POST /data/:object`: `500`, and the row was stored.

Now an `after*` hook bound from metadata that carries a `condition` opens the same unit of work, whatever its `onError` and `async`. A condition that cannot be evaluated rolls back the row and the hook chain's engine writes together. The caller is refused exactly as before.

**Unchanged:** a condition that evaluates behaves as before. `false` skips the hook, and with `true` an `onError: 'log'` hook's thrown error is logged and the row is stored. An `async: true` hook still runs after the write and its late writes still land. A write already inside a unit joins it. No unit is opened with `skipAutomations`, off the default datasource, or on a default driver with no transactions. An `onError: 'log'` or `async: true` hook with no `condition` still opens no unit.

**Cost:** one transaction per write on objects that carry such a hook. This is the same per-write cost as the unit for `onError: 'abort'` hooks. In the showcase example this covers updates to `showcase_task` and `showcase_project`, whose `async: true` `afterUpdate` hooks carry conditions.
