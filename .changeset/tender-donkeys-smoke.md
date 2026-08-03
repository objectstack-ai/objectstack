---
'@objectstack/objectql': minor
---

**Validation rules now fail CLOSED when their predicate cannot be evaluated, and the record a predicate reads is total over the object's declared fields (#4649).**

⚠️ **Behaviour change — read this before upgrading.** A `script` / `cross_field` /
`conditional` validation whose CEL predicate faulted used to be logged at WARN and
**skipped**, so the write went through. The rule stayed declared, appeared in the
metadata and in any "what protects this object" listing, and enforced nothing. Two
changes close that, and they are load-bearing together:

1. **The merged record is total on UPDATE, not just on INSERT.** Every field the object
   declares is present when the predicate runs — `null` when it is in neither the payload
   nor the prior record. Previously `previous` was whatever the driver returned, so on a
   driver that stores only written columns a predicate referencing a declared column
   aborted with `No such key` and the rule was skipped. The `previous` CEL binding is
   materialised the same way. Insert and update now behave identically.
2. **A predicate that still cannot be evaluated rejects the write** with
   `VALIDATION_FAILED`, naming the rule and — when the fault is a missing key — the key
   the predicate read and how to fix it. A validation exists to reject a write; "the rule
   could not be checked" must never resolve to "allowed".

`severity` still governs blocking: an unevaluable `warning` / `info` rule is logged and
does not throw.

**What you may see after upgrading**

- **Rules that were never running start running.** A rule skipped because of a missing key
  now evaluates and can reject writes it previously let through. This is not a regression —
  it is the declaration finally being enforced — but on an existing deployment it can
  surface as new `400 VALIDATION_FAILED` responses on writes that used to succeed. Review
  each such rule: it is doing what its author wrote.
- **Predicates guarded with `has(...)` may now reject.** `has(x)` asks whether the key is
  **present**, and a declared field holding `null` is present — so
  `has(a) && has(b) && a < b` still faults on `null < null`. Such a rule never enforced
  anything on rows with a null value (on any driver that returns its NULL columns); the
  fault used to be swallowed and is now reported. **Guard with `!= null`, not `has(...)`:**

  ```diff
  - condition: 'has(record.start_date) && has(record.end_date) && record.end_date < record.start_date'
  + condition: 'record.start_date != null && record.end_date != null && record.end_date < record.start_date'
  ```

  The rejection message says this explicitly, and `error.fields[0].constraint` carries
  `{ reason: 'unevaluable', missingKey?, hint?: 'null-comparison' }` for machine handling.
  `has()` remains correct for asking whether an **undeclared** key exists.
- **A `conditional` rule now always fetches the prior record on update.** Its `when` is
  evaluated against the merged record, so without the prior state it read a PATCH as if it
  were the whole record. One extra `findOne` per update on objects that declare one.

**Unchanged, deliberately:** a broken `regex` (`format`), an uncompilable JSON Schema
(`json_schema`), the field-level `requiredWhen` / `readonlyWhen` / option `visibleWhen`
predicates, and a rule that throws all keep their existing fail-open policy.
