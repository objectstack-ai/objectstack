---
"@objectstack/cli": patch
---

The startup banner's `Flows:` section prints flows left unbound by the deployment's scheduled-work switch as information, not as a warning.

Clause-②: no

- **Information, not a warning.** Flows that declare a time trigger but are not bound because package-authored scheduled work is off on this deployment (`OS_AUTOMATION_SCHEDULED_WORK_ENABLED` unset — the default) now print dim, under `ℹ`: `ℹ 8 flows declare a 'schedule' trigger but are NOT bound — disabled by deployment policy — … (OS_AUTOMATION_SCHEDULED_WORK_ENABLED is unset or not truthy), so no time trigger arms …: flow_a, flow_b, …`. The line's text, its flow list and its place among the other lines are unchanged. Before, it printed as a yellow `⚠`, though nothing about those flows needs fixing.
- **Every other reason keeps `⚠`.** A binding failure, a missing trigger, an unknown target object and a shadowed flow name still print as yellow warnings. The class is recognised only by the exact sentence the automation engine records for the deployment switch, so a reason that merely mentions the policy stays a warning. A host that turns scheduled work off with its own reason sentence also keeps `⚠`.
- ⛔ Nothing you author changes. Which flows bind, the scheduled-work switch, the level `@objectstack/service-automation` logs at, *Boot diagnostics* and every public key, export and parameter are unchanged.
