---
'@objectstack/service-automation': patch
---

fix(automation): for a flow name a managed package ships, every startup step arms the package's flow, and a stored flow of that name is reported as shadowed (#20913)

Clause-②: no

A startup arms flows in two steps: the boot pull from the metadata registry, then a second bind at `kernel:ready` from the metadata protocol's flow list. The second step registered every flow the list held, with no precedence at all. So for a name a managed package ships, a stored flow of the same name could be armed after the boot pull had armed the package's flow. The stored definition then ran, while `getShadowedFlows()` and the startup warnings said the package's flow was armed, and named both contenders as the package.

- Both startup steps, and the re-bind on `metadata:reloaded`, now resolve same-named flows through one precedence decision: `resolveFlowPrecedence`, with the engine's reader over the package loader's set.
- Within a name a managed package ships, the package's flow is armed and a stored flow of that name is shadowed. A managed package's flow is sealed (ADR-0126 §2): it is customized by cloning it under a new name or by switching it off. This replaces the earlier direction, in which a flow authored in the deployment won over the packaged flow of the same name.
- The shadowing record and the startup warnings name the stored flow as a runtime-authored row, not as the package. The collision warning says which rule armed the flow.
- Names no managed package ships are unchanged: flows authored in the deployment keep the order they were listed in, and two packages shipping one name still resolve by package id.

**If you call `resolveFlowPrecedence` yourself:** within a name the reader says a package ships, the packaged contender now wins over a contender authored in the deployment.
