---
'@objectstack/service-automation': patch
---

feat(service-automation)!: the flow index and the activation ledger consult on (package, name), through the one package-scoped resolver (ADR-0150 D3/D4)

Clause-②: no (narrowing) — a `subflow` or `map` node inside a packaged flow names its child by a bare name, and that name now resolves from the package that ships the flow (ADR-0150 D3): its own flow, else the one holder in its declared dependency closure (plus `sys`), else a refusal naming every candidate. Two cases that run today are refused: a name only an environment-authored flow holds (D3 (a)), and a name only a package outside the caller's declared closure holds (D3 step 3). No door, request or response shape, error code or status changes. One answer moves the other way, for a stale ledger row only: a row naming package Q no longer switches off package P's same-named flow (below).
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export of the package root is removed or retyped; one type (FlowNameResolver) and one engine method (setFlowNameResolver) are added. The refusal is a run result naming the candidates, with no stored shape for a migration to rewrite and no tombstone. -->

**BREAKING** for a packaged flow whose `subflow` or `map` node names a flow its package cannot reach: one authored in the environment, or one shipped by a package it does not declare a dependency on. Measured first-party: 0 (every `subflow` / `map` `flowName` in this repository names a flow of its own package).

- **Before.** The engine looked the child up by its bare name alone, whoever held it.
- **Now.** The child resolves from the calling flow's package through `resolvePackageScopedName` (`@objectstack/objectql`). A refused call fails the node with the resolver's sentence, which names every holder and the remedy; the child never runs.
- **Unchanged.** A child the calling package holds, or that one package in its declared closure holds, runs as before. A door, a trigger or any caller outside a run resolves environment-wide, so every bare name with one holder answers as before. A flow the registry knows nothing of (registered straight into the engine) has one holder and runs as before. An engine with no ObjectQL registry answers as before.
- **Also.** A flow name two packages hold is refused at registration, naming both, instead of arming the lexicographically first package's flow. Phase 1's one-holder refusal (ADR-0048 §3.4) already refuses the second holder at install, so no deployment reaches it today. The activation ledger's projection is keyed by `(package, name)`: a row switches off the flow of the package it names. So a row left by package Q for a name package P now ships no longer switches P's flow off; it is reachable only when one package's flow name passes to another package. A row that names no package, or any row when the engine cannot tell which package ships the name, switches the name off as before.

**The remedy.** Declare a dependency on the package that ships the child (ADR-0141), or ship the child in the calling package. For an environment-authored child, move it into a package the caller depends on.
