---
'@objectstack/plugin-security': patch
---

**An RLS denial caused by an unresolved variable now leaves a trace — and the trace carries the reason.**

When `compileCelToFilter` refuses a policy predicate, it produces a precise `detail`: which
`current_user.*` variable did not resolve, or which member of a pre-resolved membership array
came back `null`, and at what index. `RLSCompiler.compileExpression` consumed only `!ok` and
threw that `detail` away one line before the only place that could surface it, and the warn
sitting beside the drop was gated on `isSupportedRlsExpression` — a SHAPE-only test that
answers "supported" for exactly these shapes, so nothing logged.

The result was the worst-shaped failure an operator can be handed: the caller sees zero rows,
no error is raised, nothing appears in the log — and the denial is *deliberate*, the
fail-closed path working as designed, so a correct refusal is indistinguishable from "the data
genuinely doesn't match".

The drop site now keeps the compiler's reason and, when every applicable policy has dropped and
the clause actually fails closed, logs one line naming the policy, the object, the clause, the
predicate, the variable path, the member index and the consequence (`__rls_deny__`, zero rows,
a refusal rather than an empty result set). The same line covers the emptied-membership drop,
which the compiler reports as a success and this file then refuses — silent for the same reason.

Nothing about the decision moves. `RLS_DENY_FILTER` still lands in the read filter, record
attribution still excludes, zero rows still means zero rows, and `compileExpression` keeps its
published `Record | null` signature. A predicate that never compiles for any input keeps its
existing "DROPPED (no enforcement)" line (now also carrying the compiler's reason) rather than
gaining a second one; a dropped policy whose sibling still grants stays silent, because that
caller sees rows; and because this seam runs on read paths the denial line is emitted once per
distinct cause rather than once per request.
