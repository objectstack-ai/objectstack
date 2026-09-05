---
"@objectstack/plugin-hono-server": minor
---

The current-user endpoints assemble their `ExecutionContext` through the shared assembler

`makeExecutionContextResolver` — the session-to-context resolver behind
`/auth/me/permissions`, `/auth/me/localization` and `/me/apps` — built its envelope as a
hand-rolled object literal cast `as any`, beside the module that exists to make exactly
that shape unrepresentable. Six fields of the closed entry set were omitted:
`principalKind`, `onBehalfOf`, `audience`, `accessToken`, `authGate` and `oauthScopes`.

It now calls `assembleExecutionContext` (`@objectstack/core`), the fail-closed entry every
other HTTP transport already uses, with each per-face divergence passed explicitly rather
than left out silently. `principalKind` is `'human'` on these faces — the value the shared
assembler derives for a session-backed principal — and the five remaining fields are
withheld on the record. The resolver's declared return type narrows from `any` to
`ExecutionContext | undefined`, so a field added to `ExecutionContext` from now on fails to
compile here until this face decides it.

All three endpoints answer byte-identical bodies: the omission had no reachable consumer on
these routes, and the repair keeps it that way.
