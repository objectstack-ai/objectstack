---
'@objectstack/runtime': patch
---

Fix: AI HTTP routes now see the authenticated user

`HttpDispatcher.handleAI()` was invoking AI route handlers with only
`{ body, params, query }` — `req.user` was always `undefined`. This
silently broke every identity-aware feature that flows through
`/api/v1/ai/*`:

- LLM-titled conversations never fired (no actor → `autoCreateConversation`
  early-returned → no message persistence → `summarizeConversation`
  gated on `msgs.length >= 2` never tripped).
- Permission-aware tool execution fell back to system context (RLS bypass).
- HITL conversation linkage lost the operator's identity.

Two root causes were fixed:

1. `resolve-execution-context.ts` only checked `authService.api.getSession`.
   Modern auth plugins expose the better-auth handle lazily via
   `await authService.getApi()`. Now tries both.
2. `handleAI()` now threads the resolved `ExecutionContext` into
   `req.user` (`{ userId, displayName, email, roles, permissions,
   organizationId }`) before invoking the route handler, mirroring
   the shape the dispatcher-plugin already promises.

End-to-end browser verification: authenticated chat → message persisted
→ `summarizeConversation` fires → fake-OpenAI receives the title
prompt → `ai_conversations.title` updated. No code changes required
in `@objectstack/service-ai`, `assistant-routes.ts`, or
`agent-routes.ts` — they already consumed `req.user` correctly.
