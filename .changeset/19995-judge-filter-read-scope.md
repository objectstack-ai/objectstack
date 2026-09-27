---
'@objectstack/service-analytics': patch
---

fix(service-analytics): the analytics ObjectQL face asks the engine's own filter admission about a row-level read scope before composing it, and refuses a scope the engine refuses with the policy withheld (#19995)

Clause-②: no

The ObjectQL execute face composes each object's read scope into the `where` it hands `engine.aggregate`. A scope the engine refuses through a door that reads the object's declared fields (a text operator over a field that never holds a string, a temporal comparand the field cannot read, a filter on a formula field, a dotted path through a lookup) came back as the engine's `INVALID_FILTER` or `INVALID_FIELD` / 400. Both analytics HTTP doors relay a 400's message, and that message named the policy's field, and for some classes its operator or comparand. A read-scope refusal is a server fault whose detail belongs in the server log only (the #5367 ruling), so these scopes now answer `READ_SCOPE_COMPILE_FAILED` / 500 with the message withheld, like the other refusals this package's read-scope compiler and guards raise. The `driver-sql` refusals that read the `'policy'` provenance mark are unchanged: they stay a withheld `INVALID_FILTER` / 400.

**How.** The analytics face asks the engine's judge-only admission, `IObjectQLEngine.judgeFilter`, about the scope on its own before composing it. It asks at every engine-bound merge: the direct aggregate, both merges on the cross-object path, and the record-label lookup behind a lookup dimension. The engine runs the same admission it runs when it executes and stops before any driver, so a scope the engine serves is still served. The caller's own `where` is not judged here and keeps the engine's answer, including its 400 and message.

**Also fixed.** The record-label lookup `AnalyticsServicePlugin` supplies for a lookup dimension composed the referenced object's scope with only the vacancy guard. When a dataset sorted by that dimension's labels, a scope the engine refused there came back as its 400, with the policy in the message. When a dataset only displays the labels, a failed lookup is caught and the raw ids render, as before. The lookup now runs the same checks as the other merges and answers the same withheld 500.

**Wiring, and what a host without it keeps.**

- `AnalyticsServicePlugin` wires the judge automatically when it bridges `executeAggregate` to the kernel's `data` engine itself. That is the default composition, so nothing changes in host code.
- A host that constructs `AnalyticsService` directly can pass the new optional `AnalyticsServiceConfig.judgeFilter`. It must be the judgement of the engine its `executeAggregate` runs on.
- A host with no judge (a custom `executeAggregate`, or a `data` engine without `judgeFilter`) keeps today's behaviour everywhere except the plugin's record-label lookup. The scope shapes this package judges itself are still refused with the policy withheld, and the rest reach the engine unjudged, as before. That lookup's comparand and placeholder checks are new for every host that uses it, with or without a judge. So on such a host a referenced-object scope that fails one of them now answers the withheld 500 at that lookup, where it used to reach the executor. The host logs one `warn` that no judge is wired, with the remedy.
