---
'@objectstack/runtime': patch
---

fix(runtime)!: a package uninstall is refused while an active validation rule reads a field the package adds through `objectExtensions`

Clause-②: yes (narrowing) — `DELETE /api/v1/packages/:id` now refuses, with `409 PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE`, an uninstall it used to perform: one whose package adds a field through `objectExtensions` that an active validation rule of another enabled package reads.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row changes shape: what moves is the uninstall door's answer to a request that would leave a validation rule reading a withdrawn field. Nothing at rest records that answer, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the uninstall door (`@objectstack/runtime`): `DELETE /api/v1/packages/:id` asks the dependent-rule check the disable door (`PATCH /api/v1/packages/:id/disable`) already asks, and refuses on the same verdict.

- **Before.** The uninstall withdrew the package's `objectExtensions` fields from the served objects with no check. Another enabled package's active validation rule that read one of those fields then failed closed, so every write to that rule's object answered `400 VALIDATION_FAILED`, and with the package gone there was nothing left to re-enable.
- **Now.** While such a rule exists, the uninstall answers `409` with the nested `{ "error": { "code": "PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE", "message" } }` body, and nothing moves: the stored rows, the running registry and the environment's disable record stay as they were. The message is the disable door's sentence under an uninstall lead (`Package 'ID' cannot be uninstalled: …`) and names every such rule as package · object · rule, with the fields it reads. The check is the one the package entry exports as `readPackageDisableDependents` / `formatPackageDisableDependents`. An uninstall no rule depends on, and an uninstall of a package that is already disabled, proceed exactly as before.
- **Who moves.** A caller that uninstalls a package whose field another package's active rule reads.

**The remedy.** Switch off or change the rules the message names first (a packaged rule can be switched off through the tenant overlay), then uninstall.
