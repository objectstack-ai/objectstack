---
"@objectstack/mcp": minor
---

fix(mcp): the stdio MCP transport assembles its ExecutionContext with the shared assembler, and resolves localization (#7279)

`resolveStdioExecutionContext` was the last hand-written `ExecutionContext`
assembly on the platform. #6216 converged the dispatcher, REST and share-link
sites onto `assembleExecutionContext`; this face was not in that card's
inventory, so it kept building the envelope field-by-field — and fell behind it
in two ways.

| field | before | after |
|---|---|---|
| `tabPermissions` | dropped | **carried** |
| `timezone` / `locale` / `currency` | **resolved not at all** | **carried** (workspace values) |
| `accessToken` | absent by omission | **withheld by decision, on the record** |
| `positions` / `permissions` / `systemPermissions` / `userId` / `tenantId` / `email` / `posture` / `org_user_ids` / `accessible_org_ids` | carried | carried, unchanged |

## ⚠️ This changes output on the stdio surface — it is NOT a no-op

**Formula fields evaluated during a stdio call move from `UTC` to the
workspace timezone.** The read path threads `ExecutionContext.timezone` into
`ExpressionEngine.evaluate`, which defaults to `UTC` when the context carries
none (`cel-engine.ts`: `ctx.timezone ?? 'UTC'`). Every stdio call previously
carried none. **A date-bucketing formula can therefore return a different
calendar day than it did before this change** — for a workspace whose timezone
is not UTC, that is the point: the same record read over REST and over stdio
now agree, where before they could disagree by a day.

Two smaller shifts ride along:

- **Denial messages localize.** A read refused by CRUD/FLS or RLS renders in the
  workspace language (`userFacingDenialMessage`, `opCtx.context?.locale`) instead
  of English.
- **Date-dependent driver generation on the write doors** (autonumber
  `{YYYYMMDD}` tokens) resolves its calendar day from the workspace timezone.
  `buildDriverOptions`' `hasTz` gate (`execCtx?.timezone !== undefined`) is one
  of the few places where a field's ABSENCE is a meaningful state, and a stdio
  call crosses it for the first time. Pinned in both directions by
  `packages/objectql/src/engine-timezone-presence-gate.test.ts`.

If a deployment's workspace timezone is unset, `resolveLocalizationContext`
falls back to `UTC` / `en-US` — the values this face effectively used before —
and nothing changes for it.

## `accessToken` is withheld, deliberately, and now says so

The stdio face's credential is a **long-lived `osk_` API key** read from
`OS_MCP_STDIO_API_KEY`, not a session bearer. `ExecutionContext.accessToken` is
a **published hook surface** (`session.accessToken`, `spec/data/hook.zod.ts`),
so handing every `beforeFind`/`afterFind` a credential with far longer life than
the session token that surface was designed around is a product decision nobody
has made. This face passes `accessToken: undefined` with the reason written
down, matching the REST precedent. (It is also unreachable here: the value is
assigned only inside `resolve-authz-context.ts`'s
`if (!userId && typeof input.getSession === 'function')` branch, and this call
passes no `getSession`. The test injects a sentinel token at the seam anyway, so
the *decision* is pinned rather than the accident.)

## Cost, and where it is paid

`resolveStdioExecutionContext` still re-resolves the **identity** on every call,
deliberately — ADR-0101 D1, so a revoked key stops working on the next one.
Localization is resolved **once, in `start()`**, and reused: the key's tenant
cannot change mid-session, and up to three settings reads per MCP call on a
long-lived process is not acceptable steady state.
