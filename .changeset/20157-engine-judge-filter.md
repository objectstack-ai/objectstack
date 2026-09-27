---
"@objectstack/spec": minor
"@objectstack/objectql": minor
---

`IObjectQLEngine` gains an optional judge-only member, `judgeFilter(objectName, where, { operation?, context? })`, and `ObjectQL` implements it (#20157, #19995 ruling C). It answers "can this filter run against this object?" without running anything: `{ ok: true }`, or `{ ok: false, code, status, message }` with the same diagnostic execution would raise.

- **The engine's own admission, not a copy.** The judge calls the two stage functions every verb that takes a `where` already runs, in their order. First the lowering doors: the shape gate, the list-comparand shape, the virtual-field and dotted-path refusals, the text operator over a non-text field, the uninterpretable temporal comparand and the comparand-type door. Then the filter-placeholder resolver. A new door on that pipeline is judged the day it lands.
- **Nothing executes.** No driver is resolved or called, and no hook or middleware runs. The member is synchronous, so a door that needs I/O cannot join it without a contract change. Driver-level refusals and the predicates middleware composes later (RLS, sharing, tenant scope) are not judged.
- **Placeholders resolve against `context`**, exactly as execution resolves them. A context placeholder the context cannot answer (`{current_user_id}` with no user) is refused with `FILTER_TOKEN_UNRESOLVED`, never resolved to `null`.
- **`operation`** (default `'find'`) names the verb the caller will run, so the message carries that verb's prefix. The verdict is the same on every verb.
- **The message is not redacted.** It names fields, operators and comparands. A caller judging a filter it must not disclose, such as a read-scope policy, withholds the message itself.

Optional by the ruling. A caller probes for it (`typeof ql.judgeFilter === 'function'`) and keeps its current behaviour on an engine without it. Existing engine doubles and foreign engines need no change. Execution is unchanged for every CRUD caller: same diagnostics, same order.

Clause-②: yes
