---
"@objectstack/spec": minor
"@objectstack/rest": patch
"@objectstack/client": patch
---

feat(spec): declare `routes.mcp` on `ApiRoutesSchema`, and extend the discovery conformance gate one level down (#5679)

`/discovery` advertises `routes.mcp`, `objectui` reads it, and
`ApiRoutesSchema` never declared it. This is #4828's defect one level down —
with the opposite disposition: `endpoints` was retired because a census found
no reader, while `mcp` has two real ones (`ConnectAgentWidget.tsx` and
`AgentConnectSection.tsx` both gate the Integrations connect card on it), and
it is in fact the only `routes.*` key anything in `objectui` reads. So it is
declared, not removed.

Why it was a defect and not tidiness: `ApiRoutesSchema` is a plain `z.object`,
which **strips** unknown keys. Any consumer parsing `/discovery` through the
spec dropped `routes.mcp` silently — the connect card would blank with no
error. Nothing broke yet only because those two readers happen to read raw
JSON.

- **`ApiRoutesSchema` declares `mcp: z.string().optional()`**, as measured off
  both producers rather than guessed: a path string (`/api/v1/mcp`), always the
  **unscoped** base — `/mcp` is mounted bare, so a scoped mount advertising
  `/api/v1/environments/env_alpha/data` still advertises `/api/v1/mcp` — and
  `optional`, not `nullable`: the key is absent (rest-server `delete`s it, the
  dispatcher leaves it `undefined`) when MCP is disabled or unserveable.
  Neither producer ever emits `null`.
- **`@objectstack/rest` drops the two `as any` casts** at the emit site. That is
  type-only — the emitted body is byte-identical — but the cast's disappearance
  is the structural proof: with the key undeclared, removing it produced two
  `TS2339 Property 'mcp' does not exist`; with it declared, `tsc --noEmit`
  returns to its ratcheted baseline.
- **The #4828 conformance gates now cover `routes` keys**, not just top-level
  ones, in all three producer packages, deriving the allowance from
  `ApiRoutesSchema` the same way the top-level check derives it from the
  protocol schema. Extended one level, not recursed — full recursion stays out
  of scope, and `capabilities` / `services` are `z.record`s whose keys are open
  by design.

- **`@objectstack/client`'s conventional route table gains an `mcp` row.** That
  table is `Record<keyof ApiRoutes, string>` — total by design — so a newly
  declared route owes a convention, and the public `ApiRouteType` (`keyof
  ApiRoutes`) widens by one member. The path is `/api/v1/mcp`, which is what
  both producers emit, so the fallback agrees with the discovered value instead
  of competing with it. Resolution behaviour is unchanged: `getRoute()` still
  prefers the discovered route, and the pre-existing catch-all already produced
  the same string.

Corrects one detail of the issue's premise: the runtime dispatcher's
`getDiscoveryInfo()` **does** also emit `routes.mcp` (its routes literal always
carries the key, holding the path or `undefined`), so both producers were
affected, not just REST — and the new gate went red on both before the fix.
