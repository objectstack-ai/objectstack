---
'@objectstack/spec': minor
---

Security (#2991): the AI `ToolExecutionContext` contract no longer documents system-level execution as the missing-actor default. A missing `toolExecutionContext` / `actor` now means an unauthenticated (RLS-on, sees-nothing) principal — executors MUST fail closed to anonymous, never fall open to system. System execution becomes an explicit, greppable opt-in via the new `ToolExecutionContext.isSystem?: boolean` field (same convention as `IDataEngine` / `IKnowledgeService`), reserved for trusted server-side invocations and ignored when an `actor` is present. Migration for internal callers that relied on the old omission default (cron, migrations, server jobs): pass `toolExecutionContext: { isSystem: true }` explicitly.
