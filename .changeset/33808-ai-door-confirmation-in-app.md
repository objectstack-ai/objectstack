---
'@objectstack/spec': minor
---

feat(spec)!: the AI-door confirmation rule binds every AI door, the in-app assistant included, through its own pending-action channel

Clause-②: no (narrowing) — once the in-app door implements the contract, a holder of `ai:approve` can no longer approve or reject someone else's in-app pending action, and the in-app approve and reject doors refuse every credential but a person's signed-in session to the app; nothing is widened, and no export, type or signature changes.
Metadata-protocol: semantic
Skills-docs: follow-up — `skills/objectstack-ai/SKILL.md` (the "AI Pending Actions" paragraph: "an operator approves or rejects in Studio's AI Pending Actions inbox (or via `GET/POST /api/v1/ai/pending-actions/...`)") still describes today's queue, which is the door's behaviour in this release; it moves with the change that implements the in-app door, together with `content/docs/api/client-sdk.mdx` ("deciding takes `ai:approve`") and the `client.ai.pendingActions` docblock in `packages/client/src/index.ts`.

<!-- adr-0087: registered in-app-pending-action-decided-by-person -->

**BREAKING, when the implementing change ships**, for an inbox operator or administrator who approves or rejects another user's in-app AI pending action, and for a script, integration or host that decides pending actions on an API key or token. Ruled on the AI-door confirmation decision (record 6893484458): 「B 同一规则，两套流程暂留」.

⚠ In the release that carries this changeset nothing changes at any door. The in-app assistant still runs ADR-0011's queue as documented: any holder of `ai:approve` may decide an item, the approve and reject routes take whatever credential they authenticate, and an approved item is re-dispatched as before. What ships now is the contract that door moves to, in `@objectstack/spec/contracts` (`AI_ACTION_CONFIRMATION_CAPABILITY` and the `IAIService` pending-action members, `contracts/ai-service.ts`):

- Rule 1 covers every AI door that starts an action declaring `ai.requiresConfirmation: true`: the MCP `run_action` and `resume_run` tools and the in-app assistant's action tools.
- The in-app door keeps its own channel, the inline pending-approval card and the inbox (`IAIService.proposePendingAction` / `approvePendingAction` / `rejectPendingAction`, unchanged). When that channel is not wired, the door does not offer a declared-gated action as a tool at all.
- Who decides: only the person the call ran as. Holding `ai:approve`, or any other permission, does not let another user decide an item; a host that wants a second person to approve the write uses the existing `held` outcome.
- Which credential: the approve and reject doors take a person's signed-in session to the app and nothing else; an API key, token, other service credential or AI identity is refused, whoever it resolves to.
- As whom it runs: an approved item runs as that person, never as a synthetic AI principal, with every gate and permission re-checked at the moment of approval.
- The three points bind every item in the in-app queue, whichever trigger queued it (the declared flag or the destructive heuristic): a pending row does not record why it was queued, and the queue has one decider rule.
- Neither the model's own confirmation nor the caller's `confirm` counts. The in-app queue and the pending-confirmation service (`IActionConfirmationService`) stay two seams.

The semantic entry `in-app-pending-action-decided-by-person` carries the same notice, with the same timing, into the upgrade guide and `os migrate meta`.

What changes for a caller, from the release whose in-app door implements it:

- FROM an operator or administrator approving another user's in-app pending action in the inbox TO the person the call ran as approving it; a second approver is a `held` item in the approvals engine.
- FROM approving or rejecting through `POST /api/v1/ai/pending-actions/:id/approve|reject` with an API key, an OAuth token or another service credential TO the person's signed-in session to the app, whether its session token rides in the cookie or in an `Authorization: Bearer` header.
