---
'@objectstack/objectql': minor
'@objectstack/plugin-security': minor
---

feat(objectql, plugin-security): the engine composes its `ReadableIds` leaf for a delegated (on-behalf-of) caller, scoped to the delegator intersection, instead of refusing it (ADR-0139 D5.1 as amended; O5 answered)

Clause-②: no

**Before.** A read carrying an on-behalf-of link whose final `where` held a `ReadableIds` leaf was refused `INTERNAL_ERROR` / 500 before any driver was asked (ADR-0139 D5.1 as accepted), and `getReadFilter` answered the deny sentinel for every delegated context, so the leaf's consumers routed such a caller to their bounded, fail-closed probe.

**Now.**

- `@objectstack/objectql`: the executor boundary composes the leaf for a delegated caller exactly as for any other. It asks `canReadObject` and `getReadFilter` with the delegated context as it stands (`onBehalfOf` intact) and composes what the security service answers; it derives no intersection of its own. The two remaining D5 classes, a parent an object-scoped read middleware narrows and a parent bound to another datasource, are still refused by name with the same envelope.
- `@objectstack/plugin-security`: `getReadFilter` answers a delegated context the ADR-0090 D10 intersection, the six layers the engine middleware ANDs into a delegated `find` of the same object: the principal's row-level security and `controlled_by_parent` derivation, the delegator's two over the delegator's own rebuilt context, and the sharing visibility filter under each identity at its own depth. A delegated read through the leaf serves exactly the rows a delegated direct read of the parent serves. It fails closed as the chain does: a delegator who does not exist, a delegator the object does not admit, a principal or a delegator that resolves no permission set, and any resolution failure answer the deny sentinel, and the leaf is `$in: []`.

**What a reader sees.** No shipped consumer writes a leaf for a delegated caller yet (each still routes it to its probe; that routing retires per consumer on its own card), so a delegated read of `sys_activity`, `sys_audit_log`, `sys_comment`, `sys_comment_reaction` or `sys_attachment` is served as before. A door that binds `getReadFilter` directly, such as the analytics raw-SQL path, scopes a delegated context to the intersection now; as accepted it denied that context outright.

**Unchanged.** `controlled_by_parent`'s own read scope (ADR-0055 §2 mechanism (b), the pre-resolved id set) and the nested master chain, which keep their own cards; the delegated `find`, `findOne`, `count` and `aggregate` through the engine middleware, which already applied the intersection.
