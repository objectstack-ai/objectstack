---
'@objectstack/core': patch
'@objectstack/runtime': patch
'@objectstack/cli': patch
---

fix(core, runtime): the residual-twin job refusal names the artifact's top level as a holder of its own kind, `{ kind: 'residual', ownerId }`, beside every declaring package body (ADR-0150 D3, ADR-0130 D4)

Clause-②: yes (widening)
Metadata-protocol: none

`PackageScopedHolder` (`@objectstack/core`) gains one member, `{ kind: 'residual'; ownerId: string }`: a stack's residual, the top level of the artifact whose id is `ownerId`, outside every package body. `describePackageScopedHolder` names it `the top level of stack "<ownerId>" outside every package body (its residual)`. The package-scoped rule never answers it, so a resolution's `holder` is typed without it; only a refusal's `candidates` can carry it.

The app-artifact job binder's refusal of a job name a package body declares and the residual carries too (`409 RESOURCE_CONFLICT`, `ambiguous-in-environment`) now lists every declaring body as a `package` candidate and then the residual as a `residual` candidate:

| Arrangement | `candidates` before | `candidates` now |
|---|---|---|
| no body carries the artifact's id | `[package A]` | `[package A, residual(<artifact id>)]` |
| body B (declaring no such job) carries the artifact's id | `[package A, package B]` | `[package A, residual(B)]` |
| B carries the id and declares the job too, beside A | `[package A, package B]` | `[package A, package B, residual(B)]` |

Which jobs are refused, and when, is unchanged; the one-holder answer (the residual's owner IS the one declaring body) still binds to that body. The CLI stored-reference report spells a `residual` candidate as `{ holder: 'residual', ownerId }`; the registry's rule never names one there.
