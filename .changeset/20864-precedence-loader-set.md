---
'@objectstack/service-automation': minor
---

fix(automation): boot-time flow precedence takes which same-named flow is the packaged one from the package loader's set, not from the flow definitions' own provenance (#20864)

Clause-②: yes (widening)

When several flow definitions share one name at startup, the automation plugin arms one of them and shadows the rest: a flow authored in the deployment wins over the packaged flow of that name (ADR-0005). Which contender counts as the packaged one is now the answer of the set of flows a managed package's loader registered. That is the same answer the ADR-0126 §7.3 subflow guards, the arming gate and the activation switch read since #20761. The package provenance a flow definition carries is kept for display only.

- `resolveFlowPrecedence(items, logger?, packagedFlowOwner?)` and `describeFlowContender(item, packagedFlowOwner?)` take the reader as a new optional last argument, typed `PackagedFlowSource` (the reader `AutomationEngine.setPackagedFlowSource` takes). `AutomationServicePlugin` passes the engine's own `packagedFlowOwner` for you.
- A definition that claims a package's provenance for a name no package loaded ranks as a flow of the deployment. The shadowing record (`getShadowedFlows()`, and the startup warnings) no longer names that package as its source.
- With no reader, no contender is packaged. That is the engine's own answer when no reader is attached.
- Two contenders that both rank as the deployment's keep the order they were listed in. The package id orders packaged contenders only, as before.
- A startup whose registry the package loader and the stored-flow hydration filled arms the same flows as before: those entries already agree with the loader's set.

**If you call `resolveFlowPrecedence` or `describeFlowContender` yourself:** pass the loader's-set reader as the last argument, for example `(name) => engine.packagedFlowOwner(name)`. Without it no contender ranks as packaged.
