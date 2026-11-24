---
'@objectstack/plugin-sharing': patch
---

fix(sharing): a declared sharing rule grants in an organization created after boot, without a restart

Clause-②: no
Metadata-protocol: none

- **A package-declared sharing rule now grants in an organization created after the server booted.** The per-record rule hooks bound once at boot on the objects of the rules served then, and under a walled posture a declared rule is served once per organization that exists. A server that booted with no organization (a fresh environment, before its first sign-up) bound no hook on a declared rule's object, so a record written in the organization created afterwards got no `sys_record_share` grant and its recipient could not read it until the next restart. The hooks now bind on every object an active declaration names, whatever organizations serve it at that moment; the organization is resolved when a record is evaluated, so each grant stays inside its own organization.
- **The same binding covers a declared rule switched off at boot and on again later** through the activation ledger: its object stays bound, and records written after the switch are evaluated.
- Boot and the `sys_sharing_rule` data-change rebind bind through one function (`rebindRuleHooks`, reading `SharingRuleService.listRuleHookObjects()`), so the two cannot derive different object sets. `bindRuleHooks` now accepts any rows carrying `object_name` and `active` (a widening; existing callers are unaffected).
