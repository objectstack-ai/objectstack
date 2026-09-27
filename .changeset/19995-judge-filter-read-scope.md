---
'@objectstack/service-analytics': patch
---

fix(service-analytics): the analytics ObjectQL face asks the engine's own filter admission about a row-level read scope before composing it, and refuses a scope the engine refuses with the policy withheld (#19995)

Clause-②: no

The ObjectQL execute face composes each object's read scope into the `where` it hands `engine.aggregate`. A scope the engine refuses through a door that reads the object's declared fields (a text operator over a field that never holds a string, a temporal comparand the field cannot read, a filter on a formula field, a dotted path through a lookup) came back as the engine's `INVALID_FILTER` or `INVALID_FIELD` / 400. Both analytics HTTP doors relay a 400's message, and that message named the policy's field and comparand. A read-scope refusal is a server fault whose detail belongs in the server log only (the #5367 ruling), so these scopes now answer `READ_SCOPE_COMPILE_FAILED` / 500 with the message withheld, like every other read-scope refusal on every analytics face.

**How.** The analytics face asks the engine's judge-only admission, `IObjectQLEngine.judgeFilter`, about the scope on its own before composing it. It asks at every engine-bound merge: the direct aggregate, both merges on the cross-object path, and the record-label lookup behind a lookup dimension. The engine runs the same admission it runs when it executes and stops before any driver, so a scope the engine serves is still served. The caller's own `where` is not judged here and keeps the engine's answer, including its 400 and message.

**Also fixed.** The record-label lookup a dataset runs to sort by a lookup dimension's labels composed the referenced object's scope with only the vacancy guard. A scope the engine refused there came back as its 400, with the policy in the message. It now runs the same checks as the other merges and answers the same withheld 500.

**Wiring, and what a host without it keeps.**

- `AnalyticsServicePlugin` wires the judge automatically when it bridges `executeAggregate` to the kernel's `data` engine itself. That is the default composition, so nothing changes in host code.
- A host that constructs `AnalyticsService` directly can pass the new optional `AnalyticsServiceConfig.judgeFilter`. It must be the judgement of the engine its `executeAggregate` runs on.
- A host with no judge (a custom `executeAggregate`, or a `data` engine without `judgeFilter`) keeps today's behaviour. The scope shapes this package judges itself are still refused with the policy withheld, and the rest reach the engine unjudged. It logs one `warn` saying so, with the remedy.
