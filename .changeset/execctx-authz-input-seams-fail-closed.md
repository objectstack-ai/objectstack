---
'@objectstack/rest': minor
---

REST no longer reads a FAILED authorization-input lookup as "this check does not apply" — the tenancy-posture and ADR-0069 auth-gate seams in `computeExecCtx` fail closed

Two seams inside `RestServer.computeExecCtx` absorbed a FAILURE into the same `undefined` an
ABSENT wiring produces, and both feed authorization inputs. Unlike the sibling repairs in this
family — where an unknown was answered as a REFUSAL — these two pointed the other way: a failure
read as *permissive*, so a refusal was SKIPPED rather than produced. Driven on a real
`ObjectKernel`, each fault beside a positive control that is the same fixture with the one fault
removed:

| wiring | before | after |
|:--|:--|:--|
| healthy `isolated` tenancy, ex-member's org-stamped API key | 401 refused | 401 — unchanged |
| `tenancy` never registered (supported no-tenancy composition) | 200 served | 200 — unchanged |
| `tenancy` registered and FAILED to construct | **200 served, full grants** | **503** |
| auth gate INACTIVE | admitted | admitted — unchanged |
| auth gate ACTIVE, healthy re-read, gated user | 403 | 403 — unchanged |
| `isAuthGateActive()` itself THROWS | admitted | admitted — unchanged |
| auth gate ACTIVE, session re-read FAILS | **admitted, no wire trace** | **503** |

- **Tenancy posture.** Only the service registry's *branded* "never registered" rejection is
  absorbed — the `isServiceNotRegisteredError` discriminator the shipped `objectQLProvider`
  already uses one layer down. Every other rejection (a factory that threw, a scoped registration
  resolved without a scope id, a circular service dependency) raises the same loud
  `AuthzStoreUnavailableError` the data-engine seam raises, so the door answers a server-side
  outage instead of serving the request. The classification is the registry's, never message text.
  The WIRING fact is taken from the kernel's presence and never inferred from what the read
  returned.
- **ADR-0069 auth gate.** Fails closed in one precisely measured window only: `isAuthGateActive()`
  answered `true` **and** the gate's session re-read then failed. A gate the deployment declared
  active no longer vanishes silently. The common inactive path, a probe that throws, and a
  successful re-read carrying no gate all keep their existing behaviour.

Boot behaviour is unchanged: no composition that starts today stops starting. Single-kernel REST
deployments — the wiring with no `kernel-manager` service — keep their current behaviour exactly,
including the fact that `computeExecCtx` reads no tenancy posture there. What that wiring actually
skips is being measured separately and is not changed here.
