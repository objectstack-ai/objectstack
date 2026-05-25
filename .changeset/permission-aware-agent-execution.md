---
'@objectstack/spec': minor
'@objectstack/service-ai': minor
---

AI tools now execute with the end-user's `ExecutionContext`, so the
existing ObjectQL row-level-security rules automatically scope what an
agent can read and mutate.

**What changed**

- New `ToolExecutionContext` (on `@objectstack/spec/contracts`'s
  `ChatWithToolsOptions`) carries the authenticated actor, conversation
  id, and environment id through to tool handlers.
- The built-in data tools (`query_records`, `get_record`,
  `aggregate_data`, legacy `query_data`) and the auto-generated
  `action_*` tools now pass `options.context` to `IDataEngine` calls,
  mapping the actor to `{ userId, roles, permissions, isSystem: false }`.
- Assistant + agent REST routes forward `req.user` into the new
  context automatically — no caller changes required.
- When no actor is provided (cron jobs, internal callers, existing tests)
  the helpers fall back to `{ isSystem: true }`, preserving today's
  behaviour. **Fully backward compatible.**

**Why this matters**

Before this change, an AI tool call ran with system privileges and saw
every row in the tenant. Now the agent sees exactly what the human
operator would see — same RLS, same field-level masking, same audit
trail. This is the foundation for trustworthy autonomous agents.

**For custom call sites**

If you invoke `aiService.chatWithTools(...)` from your own route, pass
`toolExecutionContext: { actor: { id, roles, permissions } }` to inherit
the user's permissions. Omit it to keep the legacy system-level
behaviour.
