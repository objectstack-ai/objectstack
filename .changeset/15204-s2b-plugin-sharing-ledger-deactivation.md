---
'@objectstack/plugin-sharing': minor
---

feat(plugin-sharing)!: a sharing rule reads a position's deactivation from the activation ledger, as the authorization resolver does (ADR-0131 D3, ADR-0126 §4)

Clause-②: yes (narrowing: a position switched off in the activation ledger stops receiving sharing-rule shares in every organization; widening: a position whose `sys_position` row reads `active: false` receives them again)

<!-- adr-0087: not-required (no-migration-prescription) no authorable metadata key changes; the sharing-rule evaluator reads deactivation from the store the resolver already reads, whose own move is registered as position-permission-sets-declared -->

**BREAKING**, shipped as `minor` under the launch-window convention for breaking changes. A position's deactivation now comes from `sys_metadata_activation` instead of the `sys_position` row's `active` column, so the shares a sharing rule materializes follow the same switch the authorization resolver reads.

- A sharing rule whose recipient is a position materializes no share while that position is switched off. Switched off means a `sys_metadata_activation` row of type `position` naming it, with `active` false (a driver `0` included). The switch is deployment-wide, like the ledger, so it no longer depends on the rule's organization.
- The `sys_position` row's `active` is no longer read. A deactivation made in Setup writes that column, so until the upgrade ceremony converts it into a ledger row it stops neither the resolver nor sharing rules.
- A name with no ledger row keeps sharing, including a membership-derived position name. A composition that registers no ledger object issues no ledger read. A ledger read that fails still grants for the pass, as the row read did.
