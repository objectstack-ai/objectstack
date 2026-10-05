---
'@objectstack/service-automation': minor
'@objectstack/plugin-approvals': minor
---

fix(service-automation)!: a flow registers only if every node's config value passes the contract its executor parses, so an approval node's `escalation.timeoutHours: 0.5` is refused at registration and at package load instead of failing every run

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a refusal at registration of node config values the node's own executor already refuses at execute: an approval node config that ApprovalNodeConfigSchema refuses (escalation.timeoutHours below 1, among others) used to register and load active, then fail every run at the node. No authorable key, spelling, export or stored shape moves: ApprovalNodeConfigSchema and FlowSchema are not edited and parse exactly what they parsed, what execute accepts is unchanged, no stored row is read or rewritten, and which value an author meant is not something a ledger entry can rewrite. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id covers this rule and this diff adds none (not registered or already-registered); and the change narrows what registration accepts, not a runtime interface or a type surface alone (the NodeExecutor member it adds is optional and additive), so not runtime-interface-only or type-surface-only. -->

**BREAKING**: a flow that registered and loaded before can now be refused. It ships as `minor` under the launch-window convention for accept-set narrowings.

**What was accepted before.** Registration read a node's `config` against the node type's descriptor `configSchema` for its key NAMES only; the values were parsed for the first time when a run reached the node. An approval node whose `escalation.timeoutHours` was `0.5` (the contract says at least `1`) therefore registered through `POST /automation` and loaded `active` from a package, every record its trigger matched was created, and every run then failed at the approval node with `Approval node 'gate' has invalid config`: no approval request opened, so the record stood without the gate it was meant to pass, and the user who saved it saw nothing.

**What is refused now.** A node executor may declare the contract it parses its config against (`NodeExecutor.configContract`, an optional member). Registration parses every node of that type with it, inside region bodies too, and refuses the flow on any finding. The approval node declares `ApprovalNodeConfigSchema`, the schema its executor already parses, so every value that schema refuses is refused at registration, rules its JSON Schema cannot carry included (a `fallbackApprovers` list beside an `onEmptyApprovers` policy that never reads it, for one). Through the `/automation` write doors the refusal is `400 VALIDATION_FAILED`, the class the undeclared-key refusal already has. At package load the flow is skipped with a warning and not registered; the rest of the package loads.

**Package load, both halves.** A plugin registers its node executor from its own `start()`, after the boot pull registers the package's flows, so the boot pull cannot judge those nodes; the `kernel:ready` bind re-registers every flow once the executors exist. A flow that bind refuses is now withdrawn. Before, the boot pull's registration stayed behind the refusal's warning, so the flow stayed `active` and bound to its trigger. That covered an approval node's undeclared config key as well: it was refused with a warning and kept running. It is now withdrawn like any refused flow.

**What an author sees now.** The refusal names the flow, then one line per finding with the node, its type and the config path, followed by the contract's own sentence: `node 'gate' (approval): config.escalation.timeoutHours: Too small: expected number to be >=1`. The handling is to correct the value at the path it names; the flow then registers as before.

**Unchanged.** What `execute` accepts. A node type whose executor declares no contract, which today covers every built-in node type, `approval_revise` and any third-party node type, is judged on key names alone as before; the built-in executors still parse their contracts at execute. A flow refused on a re-registration through the write doors keeps the definition the engine already held.
