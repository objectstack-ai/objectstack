---
'@objectstack/spec': patch
---

The `IObjectQLEngine.judgeFilter` docblock states that execution refuses an object the registry does not know before admission

Clause-②: no

The comment ships in the package's type declarations (`dist/*.d.ts`); `src/contracts/objectql-engine.ts` itself is not in `files[]`. It used to say that, for an object the registry does not know, the schema-free doors still judge "as at execution". Execution now refuses such an object before admission (`OBJECT_NOT_FOUND`, 404), so the comment says that answer is about the object, not the filter, and is not this member's verdict. ⛔ No schema, parse, export or accept-set change.
