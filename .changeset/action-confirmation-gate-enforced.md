---
"@objectstack/runtime": minor
"@objectstack/mcp": minor
---

fix(runtime,mcp): `action.ai.requiresConfirmation` is ENFORCED at the AI-facing action door — an unconfirmed call is refused, and `run_action` grows the `confirm` member that satisfies it (#15942)

**Behaviour change — read this if any of your actions declare `ai.requiresConfirmation: true`.** An AI-facing invocation of such an action (`invokeBusinessAction`, reached from the MCP `run_action` tool) is now REFUSED unless the request carries the confirmation member. A call that succeeded before starts answering `428 ACTION_CONFIRMATION_REQUIRED`, and nothing dispatches: the action body does not run, and the subject record is not even read.

FROM → TO, for a caller of a gated action:

```
run_action({ actionName: 'archive_lead', recordId: 'lead_1' })                  // was: ran
run_action({ actionName: 'archive_lead', recordId: 'lead_1', confirm: true })   // now: required
```

The refusal is machine-readable so the retry is mechanical rather than guessed — `error.details` carries `{ actionName, objectName?, confirmationMember }`, and `confirmationMember` echoes the member's exact spelling (`AI_ACTION_CONFIRMATION_MEMBER`, `@objectstack/spec/contracts`). The `run_action` tool schema advertises `confirm` as an optional boolean, so an agent discovers the retry from the tool definition rather than from prose.

**What is NOT gated**, because this narrows a published accept set and the narrowing is deliberately as small as the author's own declaration:

- Only the DECLARED flag gates. `ai.requiresConfirmation: true`, set by the action's author, and nothing else. The wider `list_actions` heuristic — `mode: 'delete'` / `variant: 'danger'` on an action whose author declared nothing — still reports `requiresConfirmation: true` to advise a client, and still does NOT refuse. An explicit `ai.requiresConfirmation: false` never refuses.
- Only the boolean `true` confirms. `'true'`, `1` and `false` are not attestations.
- Only the AI-facing doors. The enforced set is the doors that enforce `ai.exposed` — today `invokeBusinessAction` via MCP `run_action`. REST `/actions` is not `ai.exposed`-gated and sits outside this gate.
- `list_actions` is unchanged.

**A gate, not a queue.** Nothing is parked, nothing is held for an operator, and there is no resume path: a refused call simply did not run, and the caller confirms with its human and retries. And `confirm: true` is an unverifiable caller claim — an agent that always sends it bypasses the gate. The gate makes FORGETTING loud; it does not prove a human.

Why it is worth the break: the flag was read once and consumed once, to fill a field of the `list_actions` summary. It stopped nothing. That is the failure ADR-0049 retired `tool.requiresConfirmation` for — "a SAFETY flag that is merely accepted is false compliance" — reappearing on the very key the retirement's own ledger entry told authors to move to. The contract this implements landed in `@objectstack/spec` first (#16293).
