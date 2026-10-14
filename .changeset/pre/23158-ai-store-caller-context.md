---
"@objectstack/spec": minor
---

`IAIConversationService.get` / `list` and `IAIService.listPendingActions` take the caller's execution context as an optional trailing parameter (ADR-0096 D5)

Clause-②: yes (widening: an optional parameter on three published store-contract methods)

- **FROM → TO.**
  - `get(conversationId)` → `get(conversationId, context?: ExecutionContext)`
  - `list(options?)` → `list(options?, context?: ExecutionContext)`
  - `listPendingActions?(filter?)` → `listPendingActions?(filter?, context?: ExecutionContext)`
- **What an implementation does with it.** When a caller supplies `context`, the implementation passes it unchanged as the `context` of every engine read the method makes (`BaseEngineOptions.context`), so the read runs as that caller. Under ADR-0096 D5 strict mode an engine read with no principal is refused with 403, so without a caller an implementation can only read as system. The type and the position are the ones `ISharingService`, `IApprovalService`, `IShareLinkService` and `IAnalyticsService` already use.
- **Nothing to migrate.** The parameter is optional. A caller that omits it gets the read the implementation made before, and an implementation written against the shorter signatures still satisfies both interfaces. To read as the caller, pass the request's `ExecutionContext` and forward it to your engine reads.
- `list`'s `options.userId` stays a filter on the conversation's owner. It is not the caller's identity.
- Whether an ordinary member is admitted to their own rows depends on the stored objects' access and sharing, which these contracts do not declare.
