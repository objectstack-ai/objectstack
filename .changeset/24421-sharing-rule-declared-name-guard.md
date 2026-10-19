---
'@objectstack/plugin-sharing': minor
'@objectstack/runtime': minor
---

fix(plugin-sharing,runtime)!: a declared sharing rule is read-only and clonable — no rule, new or renamed, can take its name, and it is switched off through the activation ledger, which revokes its grants at once

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) no spec key, export, option or stored metadata shape is added, removed or renamed, so `objectstack migrate meta` has nothing to rewrite; what changes is the accept set of two write doors, whose remedy is another name for the caller's rule plus one activation call -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

ADR-0131 D6 charts declared sharing rules under regime C: a rule a package declares is read-only, it is customised by a clone under another name, and it is switched off through the deployment-level activation ledger (`sys_metadata_activation`), like flows, actions, positions and permission sets. Same-name shadowing is retired.

The narrowings, FROM → TO, each with its one-line fix:

- `POST /api/v1/sharing/rules` (and `SharingRuleService.defineRule`) creating a rule under a declared rule's name — FROM `201`, the new row replacing the declared rule in its scope, TO `409 RESOURCE_CONFLICT` naming the declared rule. Fix: create your rule under another name, and switch the declared one off with `POST /api/v1/security/_activation/sharing_rule/<name>` and `{ "enabled": false }`.
- A `/data` insert of a `sys_sharing_rule` row under a declared rule's name, or an update that renames a row onto one — FROM `201` / `200`, TO `409 RESOURCE_CONFLICT`. Fix: the same.

What is added:

- **The switch.** `POST /api/v1/security/_activation/sharing_rule/:name` writes the declared rule's activation row, behind the same authority as the other activation doors: `manage_metadata`, and the platform operator under a wall, because the row covers every organization. A declared rule switched off is served nowhere. The write revokes every grant that carries the rule's name in the same request, and switching it back on re-derives them. The name must be a declared rule (`404` otherwise; a rule your organization authored keeps its own `active` field), and with no sharing-rule service bound the door answers `503`.
- **A declaration over a stored row is reported, never made an overlay.** When a package declares a rule whose name a `sys_sharing_rule` row already holds in a scope (a package upgrade, or a copy customised before this release), the row keeps answering as its own rule. The declaration is not served beside it, and that is logged at `error` once per name and scope per process, with the remedy.

Unchanged: rules whose name no declaration holds are created, renamed and switched as before. A stored row that already holds a declared name stays editable as itself. `DELETE /api/v1/sharing/rules/:idOrName` on a declared rule is still `403 PERMISSION_DENIED`, and is now answered the same way when the rule is switched off.
