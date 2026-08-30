---
"@objectstack/client": minor
---

feat(client): `environments.create()` declares the three response keys the control plane really sends — `warnings`, `durationMs`, and a conditional `hostnameAssignment` (#12883)

`client.environments.create()` declared its unwrap shape as the single key
`environment`, while `POST /api/v1/cloud/environments` answers `201` with three
more. `warnings` in particular is the channel a partially-degraded provision
uses to report what it could not do, and no SDK caller could reach it without
an `as any`.

This is **additive**: `environment` keeps its shape and every existing call site
keeps compiling. What changes is that three previously-erased keys are now
declared and reachable.

```ts
const res = await client.environments.create({ organization_id, display_name });

res.warnings;             // string[]  — partial-degradation channel, no cast needed
res.durationMs;           // number
res.hostnameAssignment;   // optional — present ONLY when the control plane
                          // renamed a colliding hostname; absence stays absence
```

Per the 2026-08-29 maintainer ruling (verbatim 「同意」, option 甲) the three keys
are typed as the **inline wire shape** and are deliberately **not** bound to
`@objectstack/spec/cloud`'s `ProvisionEnvironmentResponseSchema`: those are
camelCase row contracts, and the `/api/v1/cloud/*` control plane this namespace
calls speaks snake_case — the constraint already recorded on the namespace
docblock. Binding them would typecheck and be false.

The request side of the same method is untouched and remains a separate card.
