---
'@objectstack/lint': minor
---

`os validate` refuses an `api` flow with no per-flow secret, the flow the automation engine already refuses to register (#20553).

Clause-②: yes (accept/reject: `os validate` newly refuses a secretless `api` flow)

`validate-flow-trigger-readiness` gains one rule id, `flow-api-trigger-secret-missing`, at `error`. It names a flow whose binding resolves to the inbound `api` trigger when that flow's start node carries no usable `config.secret`. A usable secret is a string that is non-empty after trimming. The rule fires for a missing, blank or non-string secret, and for an `api` flow with no start node.

**Why.** ADR-0041's `trigger-api` acceptance criteria require a per-flow secret with HMAC verification. In the same release, the automation engine refuses such a flow in `registerFlow`, whatever its `status`: the `/automation` write doors answer `400`, and a boot skips the flow with a warning. `ApiTrigger.start()` also refuses to arm it. `os validate` builds neither, so it answered `✓ Validation passed` for a flow no runtime would register. It now exits non-zero and names the flow.

**Which flows count as `api`-bound.** The rule uses the engine's own binding, `deriveTriggerBinding`. An array-form record `triggerType` goes to the record-change trigger first. Otherwise the flow gets the kind `resolveFlowTriggerKind` answers, which is a flow declaring `type: 'api'` or a start-node `triggerType: 'api'`. The engine gives the record-change, time-relative and schedule triggers precedence over `api`. So a `type: 'api'` flow whose start node also carries a `record-*` token, a `timeRelative` descriptor or a `config.schedule` binds that other trigger. The engine never asks that flow for a secret, and the rule stays silent on it.

**Where the refusal surfaces.** The rule is `CLI_AND_RUNTIME`, so it gates in two places:

- `os validate`, `os build` and `os lint`.
- The runtime metadata publish gate. A `state: 'active'` write of a secretless `api` flow now carries this `error`, so the gate refuses it before the flow is stored. Before this change the gate passed that write.

The gate judges only the item being written, so existing stored flows are not re-judged.

**Fix.** Set a non-blank `config.secret` on the flow's start node, and sign each post with it in the `x-objectstack-signature` header. A flow that is only ever started explicitly and never receives inbound posts is `type: 'autolaunched'`, with no `triggerType: 'api'` on its start node, and it needs no secret.

`FLOW_API_TRIGGER_SECRET_MISSING` is exported from `@objectstack/lint`.
