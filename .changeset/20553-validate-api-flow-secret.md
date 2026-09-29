---
'@objectstack/lint': minor
---

`os validate`, `os build` and `os lint` refuse an `api` flow with no per-flow secret, the flow the automation engine already refuses to register (#20553).

Clause-②: yes (narrowing — `os validate` / `os build` / `os lint` newly refuse a secretless `api`-bound flow; the new exported rule id `FLOW_API_TRIGGER_SECRET_MISSING` widens `@objectstack/lint`)

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable changes spelling or type: `packages/spec` is untouched, and the start node `config` stays the open record it was. What changes is that three authoring commands, `os validate` / `os build` / `os lint`, now refuse one authored shape: an `api`-bound flow whose start node carries no usable `config.secret`. `objectstack migrate meta` could not rewrite that shape even in principle, because the missing value is a shared secret only the author and the sending system can supply. A stored flow of that shape has been refused at registration by `@objectstack/service-automation` since 17.5.0, whose published changelog entry records that load path's disposition; nothing here judges a stored row. -->

**BREAKING** — an accept-set narrowing on three authoring commands, shipped as
`minor` under the launch-window convention (`check-changeset-no-major` refuses
`major` until GA; breaking-ness is carried by this banner and the ADR-0087
disposition above, not by the level). A stack that declares an `api`-bound flow
whose start node carries no usable `config.secret` used to pass `os validate`,
`os build` and `os lint`; they now exit non-zero and name the flow.
**One-line fix:** set a non-blank `config.secret` on the flow's start node — or,
for a flow that is only ever started explicitly, declare `type: 'autolaunched'`
with no `triggerType: 'api'`.

`@objectstack/lint` gains one rule id, `flow-api-trigger-secret-missing`, at `error`, emitted by a new exported rule, `validateFlowApiTriggerSecret`, in the `validate-flow-trigger-readiness` family. It names a flow whose binding resolves to the inbound `api` trigger when that flow's start node carries no usable `config.secret`. A usable secret is a string that is non-empty after trimming. The rule fires for a missing, blank or non-string secret, and for an `api` flow with no start node.

**Why.** ADR-0041's `trigger-api` acceptance criteria require a per-flow secret with HMAC verification. Since 17.5.0 the automation engine refuses such a flow in `registerFlow`, whatever its `status`: the `/automation` write doors answer `400`, and a boot skips the flow with a warning. `ApiTrigger.start()` also refuses to arm it. `os validate` builds neither, so it answered `✓ Validation passed` for a flow no runtime would register. It now exits non-zero and names the flow.

**Which flows count as `api`-bound.** The rule uses the engine's own binding, `deriveTriggerBinding`. An array-form record `triggerType` goes to the record-change trigger first. Otherwise the flow gets the kind `resolveFlowTriggerKind` answers, which is a flow declaring `type: 'api'` or a start-node `triggerType: 'api'`. The engine gives the record-change, time-relative and schedule triggers precedence over `api`. So a `type: 'api'` flow whose start node also carries a `record-*` token, a `timeRelative` descriptor or a `config.schedule` binds that other trigger. The engine never asks that flow for a secret, and the rule stays silent on it.

**Where the refusal surfaces.** `os validate`, `os build` and `os lint`. The runtime metadata publish gate is deliberately not covered yet (#20611): it judges a `/meta` save before the stored secret the flow read path withholds is restored, so for now a secretless flow saved there is still stored, and the engine then refuses it at registration.

**Fix.** Set a non-blank `config.secret` on the flow's start node, and sign each post with it in the `x-objectstack-signature` header. A flow that is only ever started explicitly and never receives inbound posts is `type: 'autolaunched'`, with no `triggerType: 'api'` on its start node, and it needs no secret.

`validateFlowApiTriggerSecret` and `FLOW_API_TRIGGER_SECRET_MISSING` are exported from `@objectstack/lint`.
