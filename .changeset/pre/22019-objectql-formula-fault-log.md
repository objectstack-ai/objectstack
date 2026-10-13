---
"@objectstack/objectql": patch
---

fix(objectql): a formula field that does not evaluate is logged once per object and field, instead of reading `null` in silence (#22019)

A formula the engine cannot evaluate reads `null`, on `find`, on `findOne` and on the write response. Before this change nothing said why. A formula calling an unregistered function (`sqrt(record.amount)`) read `null` on every row with no log line anywhere. ADR-0032 says a call site must not silently swallow an expression fault.

The engine now reports the fault through its logger at `warn`, once per (object, field) per engine instance, however many rows and reads hit it. The line names the object, the field and the evaluator's error (kind and first line; the full message is in the log metadata). It also says where the repair is: `os validate` or a re-save of the object refuses an expression-level fault with a located message, and a fault that depends on a record's values needs a guard on the operands it reads.

Unchanged: the field still reads `null`, because what a read returns is protocol. `evaluateFormulaField`, the hook-side helper with no engine, still returns `null` without a log line. The built entry declarations gain three `private` member names on `ObjectQL`.
