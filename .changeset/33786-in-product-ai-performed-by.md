---
'@objectstack/spec': patch
'@objectstack/objectql': patch
'@objectstack/runtime': patch
---

feat(spec): the server-constructed in-product AI path can name itself on `ExecutionContext.performedBy`, and hooks see it on `HookContext.provenance`

Clause-②: yes — widened: `ExecutionContext.performedBy` accepts three new optional keys beside `clientId`: `agentId` (the in-product AI agent that performed the write for the signed-in person), `conversationId` (the AI conversation) and `confirmationId` (the id of the pending item the person approved). `clientId` is now optional, and a `performedBy` must name at least one of `clientId` and `agentId`, so `{ agentId }` parses where only `{ clientId }` did; a `performedBy` naming neither is refused at parse exactly as before, and the published JSON Schema states that rule as an `anyOf`. `HookContext.provenance` accepts `performedByAgentId`, `performedByConversationId` and `performedByConfirmationId`, each copied from its `performedBy` sibling by the engine the way `performedByClientId` is copied from `clientId`, and a sandboxed hook body reads them on `ctx.provenance` too.
Metadata-protocol: none

Before this, the in-product AI had no place on the write context: it writes as the person, and `ObjectQL#createContext` parses the envelope, so an `agentId` a host put on `performedBy` was dropped there and the write looked like the person's own. The attribution stays server-constructed and never client-supplied, no security middleware reads it, and it never becomes the subject a write is authorized as; the write still runs as the person, with `userId` theirs and no `onBehalfOf`. The OAuth `/mcp` door is unchanged: it still sets `performedBy.clientId` alone, and hooks still see `provenance.performedByClientId`.

What to do: nothing, unless your TypeScript reads `ExecutionContext['performedBy']` and assumes `clientId` is there. It is now `string | undefined`, because the in-product AI path names `agentId` instead; check it before use, as `performedBy?.clientId` readers already do. Recording these keys in `sys_audit_log` is a separate change to the audit writer.
