---
"@objectstack/rest": minor
---

fix(rest): a data engine that cannot be RESOLVED no longer answers `403 FORBIDDEN` — for hosts that wire their own objectql provider (#13476)

Runtime behaviour change on a public REST door, shipped as `minor` under the
repo's launch-window convention — the same convention #13279's changeset names
for the identical class of change.

**Reach — read this first if you are deciding whether this release fixes
*your* 403.** The repair lands at `RestServer`'s provider seam, so it takes
effect in deployments that wire their **own** `objectql` provider — one that
throws or rejects when the engine cannot be resolved. The **shipped
single-kernel wiring is not yet covered**: the provider `rest-api-plugin.ts`
hands over absorbs the failure one layer earlier (`catch { return undefined }`),
so an engine that fails to resolve still reaches the seam as a *resolved*
`undefined` — indistinguishable there from the supported "no engine wired"
shape — and the package door still answers `403 FORBIDDEN`. That absorb is
filed as #13904; until it lands, deployments on the shipped single-kernel
wiring see **no behaviour change** from this fix.

`RestServer.computeExecCtx` resolved the data engine through the seam helper
that absorbs any failure to `undefined`. So an engine that could not be
**resolved** and an embedder that had wired **no engine at all** arrived at
`resolveAuthzContext` as the same value. The resolver then took `tryFind`'s
`!ql` guard — correctly, for its own contract, because "no engine is wired" is a
supported embedder shape that must keep resolving to an empty-but-valid envelope
— and the package-management door answered `403 FORBIDDEN`: "Reading packages
requires the `studio.access` or `setup.access` capability."

Two different facts had collapsed into one value:

- an embedder that never configured a data plane — zero capabilities is **true**;
- a deployment whose engine resolution **failed** — zero capabilities is **unknown**.

Measured on a real `RestServer` with a real `registerPackageRoutes`. The fault
leg was driven with an injected provider that rejects — the shape a host
wiring its own provider produces, and one the shipped plugin's provider never
does (it absorbs to a resolved `undefined`):

| wiring | before | after |
|:--|:--|:--|
| healthy engine granting the capabilities | 200 | 200 |
| no engine wired at all (supported shape) | 403 | 403 — unchanged |
| own provider: engine resolution throws or rejects | **403 FORBIDDEN** | **503 SERVICE_UNAVAILABLE** |
| shipped single-kernel wiring: failure absorbed to `undefined` (#13904) | 403 | 403 — unchanged, pinned |

The provider branch of the seam now takes the wiring fact from the provider's
**presence** rather than inferring it from what the provider returned, and a
wired seam that fails raises the existing `AuthzStoreUnavailableError`. A
provider that *resolves* `undefined` still means "no engine", quietly and
unchanged — that is the seam contract declaring absence, not failing. That same
quiet path is what keeps the shipped wiring out of reach until #13904: its
provider declares absence where it has only observed failure.

This is **coverage of #13279's already-ruled class**, not a new trade-off. That
ruling (2026-08-30, verbatim 「第一批其余同意」) settled the direction: a
permission-store read that fails must fail loud rather than resolve as an
authenticated principal holding zero capabilities. `tryFind` implemented it for
a read that was issued and threw; an engine that cannot be resolved never issues
a read, so the ruling's landing point could not see it.

⚠️ The direction is **conservative in both readings**: the unknown was already
answered as a refusal (403) and is now answered as the outage it is (503).
Nothing that was refused becomes served, and no route changes who may reach it.

⚠️ Not repaired here, and filed rather than left implicit — the same disguise
survives in two named places:

- **#13904** — the shipped single-kernel provider in `rest-api-plugin.ts`
  absorbs resolution failure into a resolved `undefined` one layer before this
  seam (the reach boundary above). `ctx.getService` throws for three
  distinguishable conditions and only one of them means "no engine is wired",
  so which of them the provider should re-raise is its own judgement, filed
  rather than folded in.
- **#13905** — the **kernel** branch of the same seam resolves through
  `kernel.getServiceAsync('objectql')`, which rejects identically whether the
  service was never registered (the supported no-data-plane shape) or was
  registered and failed to construct. Separating those two needs the service
  registry to stop conflating them, which is a `@objectstack/core` contract
  change.

**ADR-0087 disposition.** This change touches no metadata surface in either
direction — no Zod schema, no spec declaration, no authorable key, no stored
row, no object definition — so `objectstack migrate meta` has nothing to visit
and no tombstone exists to mint. `SERVICE_UNAVAILABLE` is an existing
`StandardErrorCode` member; `HttpStatusErrorCodeMap` — the status→code map —
already carries `503: 'SERVICE_UNAVAILABLE'`, and the error-code ledger pins
the code→status direction (`SERVICE_UNAVAILABLE: 503`). The wire vocabulary is
unchanged; only which declared code this condition selects.
