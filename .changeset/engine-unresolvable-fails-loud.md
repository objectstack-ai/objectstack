---
"@objectstack/rest": minor
---

fix(rest): a data engine that cannot be RESOLVED no longer answers `403 FORBIDDEN` — the last surviving GRANTS-LOST disguise at the package door (#13476)

Runtime behaviour change on a public REST door, shipped as `minor` under the
repo's launch-window convention — the same convention #13279's changeset names
for the identical class of change.

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

Measured on a real `RestServer` with a real `registerPackageRoutes`, wired the
way `rest-api-plugin.ts` wires it:

| wiring | before | after |
|:--|:--|:--|
| healthy engine granting the capabilities | 200 | 200 |
| no engine wired at all (supported shape) | 403 | 403 — unchanged |
| the engine cannot be resolved            | **403 FORBIDDEN** | **503 SERVICE_UNAVAILABLE** |

The provider branch of the seam now takes the wiring fact from the provider's
**presence** rather than inferring it from what the provider returned, and a
wired seam that fails raises the existing `AuthzStoreUnavailableError`. A
provider that *resolves* `undefined` still means "no engine", quietly and
unchanged — that is the seam contract declaring absence, not failing.

This is **coverage of #13279's already-ruled class**, not a new trade-off. That
ruling (2026-08-30, verbatim 「第一批其余同意」) settled the direction: a
permission-store read that fails must fail loud rather than resolve as an
authenticated principal holding zero capabilities. `tryFind` implemented it for
a read that was issued and threw; an engine that cannot be resolved never issues
a read, so the ruling's landing point could not see it.

⚠️ The direction is **conservative in both readings**: the unknown was already
answered as a refusal (403) and is now answered as the outage it is (503).
Nothing that was refused becomes served, and no route changes who may reach it.

⚠️ Not repaired here, and filed separately rather than left implicit: the
**kernel** branch of the same seam resolves through
`kernel.getServiceAsync('objectql')`, which rejects identically whether the
service was never registered (the supported no-data-plane shape) or was
registered and failed to construct. Separating those two needs the service
registry to stop conflating them, which is a `@objectstack/core` contract change
and its own card.

**ADR-0087 disposition.** This change touches no metadata surface in either
direction — no Zod schema, no spec declaration, no authorable key, no stored
row, no object definition — so `objectstack migrate meta` has nothing to visit
and no tombstone exists to mint. `SERVICE_UNAVAILABLE` is an existing
`StandardErrorCode` member and `HttpStatusErrorCodeMap` already maps it to 503,
so the wire vocabulary is unchanged; only which declared code this condition
selects.
