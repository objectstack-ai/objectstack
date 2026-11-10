---
'@objectstack/service-automation': patch
'@objectstack/objectql': patch
---

fix(service-automation)!: a flow `script` node runs the function of its own flow's package — a name that means no single function for that flow is refused naming every holder, and the hook binder keeps a package's own function after another package registers the name (ADR-0150 D3)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which registered function a script node's name answers and which a hook's engine read binds, the flow and hook metadata are read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

A flow `script` node resolved `config.function` through the engine's bare function map, which keeps the last registration per name. It now resolves through the one package-scoped resolver for functions (`resolvePackageScopedFunction`, `@objectstack/objectql`), in the package of the calling flow: the package whose own body is armed under the flow's name (`AutomationEngine#armedFlowPackage`). An environment-authored flow and an environment override of a packaged flow are callers with no package. A packaged flow gets its own package's function, else the one holder in its declared dependency closure (plus `sys` and the platform's owner-less function), else a refusal. A caller with no package gets the one holder in the environment, else a refusal. The refusal is `PackageScopedNameRefusedError` (`409 RESOURCE_CONFLICT`, every candidate named). The step fails as a guard with the refusal's text, `code: 'RESOURCE_CONFLICT'` (`$error.code`) and `innerRefusal: { code: 'RESOURCE_CONFLICT' }`. So every door that reports a failed run answers `400 FLOW_FAILED` with `error.details.innerRefusal.code: 'RESOURCE_CONFLICT'`: `POST /automation/:name/trigger`, the resume door of a paused (screen) flow, a flow-type action at `/actions` (and the MCP `run_action` bridge), and a declared endpoint that runs a flow. A name with one holder in the caller's reach (own, closure, environment-wide or platform) runs exactly the function it ran before, with the `effect` it declared.

An action `target` is not touched. It names a handler key in the action registry, which E2 already resolves by package; no action reads the function registry.

**BREAKING** for these answers (first-party count: 0 for each — the booted showcase, crm and multi-package apps hold no function name twice and no owner-less function, and the one first-party `script` node names its own package's function):

1. A packaged flow naming a function two packages hold, one of them its own, ran the last-registered holder's function. It now runs its own. A fix.
2. A flow with no package naming a function two packages hold ran the last-registered one. The step now fails `RESOURCE_CONFLICT` (`ambiguous-in-environment`) naming both, and each flow door answers `400 FLOW_FAILED` carrying it.
3. ADR-0150 D3 (c): a packaged flow naming a function that only a package outside its declared dependency closure holds was served that function. The step now fails `RESOURCE_CONFLICT` (`outside-closure`) naming the holder. This is the one refusal a single holder gets. A function registered under an owner that is no installed package is refused the same way for a packaged flow.
4. The platform's owner-less function beside a package's function of the same name ran the last registration. For a caller with no package, or a packaged flow that holds none itself and reaches the package holder, the step now fails `RESOURCE_CONFLICT` naming both.
5. A packaged flow holding none, with two holders in its declared closure, ran the last registration. The step now fails `RESOURCE_CONFLICT` (`ambiguous-in-closure`) naming both.
6. Published in-process API: `AutomationEngine#resolveFunction(name)` returned the last registration for every shape in 2–5. It is now `resolveFunction(name, context?)`, resolved for `context`'s flow (no `context`: a caller with no package), and it THROWS `PackageScopedNameRefusedError` for those shapes. `FlowFunctionResolver` gains a second parameter, `callerPackageId: string | null`. A one-parameter resolver still type-checks and is still called.
7. A host whose `objectql` service offers `resolveFunction` but not `functionHoldersOf` had its script nodes bridged to the bare map. It is now left unbridged, so the step fails "no function named … is registered". Every `ObjectQL` offers `functionHoldersOf`.
8. A packaged flow holding none, with one holder in its declared closure and another holder outside it registered last, ran the outside holder's function. It now runs the closure holder's (served by a different holder, not refused).
9. A packaged flow holding none, with the platform's owner-less function and a package holder outside its closure, ran the last registration. It now runs the platform's (served by a different holder, not refused).

**Widening** (objectql `bindHooksToEngine`): a hook whose string `handler` names a function its own package registered on the engine earlier, with no `functions` handed to the bind, was refused `400 INVALID_REFERENCE` once another package had registered the same name, because the bare map's entry then named the other package. It is now bound to its own package's function. The rule is still own package only: every other holder (a closure holder, the platform's owner-less function, another package's) is refused `400 INVALID_REFERENCE` as before. Two more answers move with it:

- A hook bound on an engine that carries `resolveFunctionEntry` but not `functionHoldersOf` (reachable only through a cast; every `ObjectQL` carries both) was bound to its own package's engine-registered function. It is now refused `400 INVALID_REFERENCE`, the same class as item 7.
- After `unregisterFunctionsByPackage` removes the last package that registered a name, an earlier package's function of that name is served again (to its own hooks, and to every flow it is in reach of), where the bare map answered "no function". No source caller of that method exists.

The fix for each:

- FROM a flow with no package naming a two-holder function (or a platform function beside a package's) TO a packaged flow in the package whose function it means, or a renamed function.
- FROM a packaged flow naming a function held only outside its closure TO the holder declared in the flow's package `dependencies` (ADR-0141); for a function whose owner is no installed package, TO an owner-less registration (the platform) or a registration under the package that ships it.
- FROM a packaged flow holding none with two (or a package and the platform) in reach TO the function registered in the flow's own package, or one holder in reach.
- FROM `engine.resolveFunction(name)` reading one of several holders TO `engine.resolveFunction(name, context)` with the calling run's context, catching `PackageScopedNameRefusedError` (or `code === 'RESOURCE_CONFLICT' && refusal.status === 'refused'`).
- FROM a custom `objectql` service (or an engine handed to `bindHooksToEngine`) without `functionHoldersOf` TO one that offers it (and `registry`), as `ObjectQL` does.
- FROM a packaged flow that relied on an outside holder's function, or on the last registration (items 8 and 9), TO that function registered in the flow's own package (a package's own function is reached first), or to a function renamed apart.
