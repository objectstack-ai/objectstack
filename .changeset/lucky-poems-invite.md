---
"@objectstack/plugin-hono-server": minor
---

fix(plugin-hono-server): the current-user faces assemble their `ExecutionContext` through the shared assembler (#15747)

**BREAKING** for TypeScript consumers — a published TYPE-surface narrowing, shipped as `minor` under the launch-window convention (`major` is refused by `check-changeset-no-major`, so the BREAKING banner and the ADR-0087 disposition are the carriers, not the level).

`makeExecutionContextResolver` is exported from this package's index. Its declared return moves **from** `(ctx: CurrentUserEndpointsContext) => (c: any) => Promise<any | undefined>` — in practice `any`, since the exported function carried no return annotation at all and the envelope it built was a hand-rolled object literal cast `as any` — **to** `(ctx: CurrentUserEndpointsContext) => (c: any) => Promise<ExecutionContext | undefined>`. `any` is assignable to everything and admits every property read, so a consumer's code really can stop compiling.

What this asks of a consumer holding the resolver directly (the serverless host path that composes it, cloud#924): narrow the `undefined` arm before reading the envelope — under `strictNullChecks` the resolver has always been able to answer `undefined` for a request with no session, and no caller was ever asked to handle it; and stop reading members `ExecutionContext` does not declare, since the receiver is no longer `any`. A consumer that only calls `registerCurrentUserEndpoints` sees no change.

The envelope itself is now assembled by `assembleExecutionContext` (`@objectstack/core`) — the fail-closed entry every other HTTP transport already uses — instead of the hand-rolled literal, which omitted six fields of the closed entry set: `principalKind`, `onBehalfOf`, `audience`, `accessToken`, `authGate` and `oauthScopes`. `principalKind` is `'human'` on these faces, the value the shared assembler derives for a session-backed principal; the other five are withheld on the record. A field added to `ExecutionContext` from now on fails to compile here until this face decides it.

No runtime behaviour changes: `/auth/me/permissions`, `/auth/me/localization` and `/me/apps` answer byte-identical bodies, pinned as goldens.

<!-- adr-0087: not-required (type-surface-only packages/plugins/plugin-hono-server/src/current-user-endpoints.ts#makeExecutionContextResolver) A published return type moves off an erased `any` onto the kernel's own `ExecutionContext`: no metadata key is removed, renamed or re-shaped, this diff touches no `packages/spec/**` path and no ADR-0087 shape surface (no `*.zod.ts`, no `packages/spec/src/contracts/**` entry, no object definition), and nothing exists for `objectstack migrate meta` to rewrite. The affected party is a TypeScript consumer and the delivery channel is the compiler at their own call site, which reaches every one of them rather than the subset who read release notes. -->
