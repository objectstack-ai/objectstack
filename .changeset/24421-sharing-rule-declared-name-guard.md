---
'@objectstack/plugin-sharing': minor
'@objectstack/rest': patch
---

fix(plugin-sharing)!: a new sharing rule, or a rename, cannot take a declared rule's name — the edit of the declared rule stores its customised copy, and that write reconciles the declaration's grants at once

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no spec key, export, option or stored shape is added, removed or renamed; the narrowing is a refusal of a write the platform never meant to accept (a row that silently replaced a vendor rule), and the edit path that stores a customised copy keeps accepting every body it accepted, plus the projection's id -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A `sys_sharing_rule` row holding a declared rule's name replaces the declared rule in its scope (ADR-0131 D6, regime O): that is how an organization narrows or switches off a vendor rule. Until now any write could take the name — Setup's New, a script, an AI tool — and so switch the vendor rule off without anyone asking to.

- **Refused now:** `POST /api/v1/sharing/rules` (and `SharingRuleService.defineRule`) creating a rule under a declared rule's name, and a `/data` insert of `sys_sharing_rule` under one, or an update that renames a row onto one. FROM `201` / `200` with the new row replacing the vendor rule, TO `409 RESOURCE_CONFLICT`, naming the declared rule. Fix: to customise the vendor rule, save it back with its `id` (the declared rule's name, as `GET /api/v1/sharing/rules` lists it); otherwise choose another name.
- **Unchanged:** saving the declared rule with its `id` stores the organization's customised copy, exactly as a same-name `POST` did before; editing or switching off that copy, through either door, works as before; every rule whose name no declaration holds is created and renamed as before.
- **Reconciled at once:** the write that creates the customised copy, switches it on or off, or removes it reconciles the declaration's grants in that scope in the same request — revoked while the copy holds the name, re-derived when it no longer does. Before, the declaration's grants stood until the next boot's orphaned-grant sweep. Under a wall an organization's copy is its own (the other organizations keep the declared rule); under `single` the one copy answers everywhere.
