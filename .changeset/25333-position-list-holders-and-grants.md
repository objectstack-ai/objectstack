---
'@objectstack/spec': patch
'@objectstack/core': patch
'@objectstack/plugin-security': patch
'@objectstack/rest': patch
---

feat: the position list can say who holds each position and which permission sets it grants, read where the resolver enforces both

Clause-②: yes (widening: `GET /meta/position?include=grants` adds two read-only served keys per position, `_holderCount` and `_grantedPermissionSets`; `ISecurityService` gains the optional `describePositionGrants`)
Metadata-protocol: none

Setup → Positions could not answer "who is a sales manager, and what do they get?". The list now can, and its answer is the enforcement path's, not a second copy of it.

- **`GET /meta/position?include=grants`** (`@objectstack/rest`, both transports through the shared list chain). Each position gains `_holderCount` and `_grantedPermissionSets: [{ name, via }]`. Without `?include=grants` the list is unchanged, so the pickers and assignment pages that read it pay no extra read.
- **`via: 'definition'`** marks a set the position's `permissionSets` names. **`via: 'name'`** marks the set that shares the position's name and that the definition does not list. The position-name fold grants it anyway (the `position_name_fold_grant` warning), so the list shows it rather than hiding a grant that is in force.
- **The sets** are the ones the resolver grants a holder of that position alone. A position or set switched off in the activation ledger grants nothing, and a name the catalog holds no set for confers nothing.
- **`_holderCount`** counts the people who hold the position in the caller's active organization, by the rule the resolver uses to give a caller positions: `sys_user_position` rows in their validity window, membership roles, and `everyone` for every active member. A switched-off position keeps its holders (ADR-0049). The count is `null`, never `0`, with no active organization, for `platform_admin` and `guest`, after a truncated read, and for a caller who may not read `sys_user_position`.
- **`ISecurityService.describePositionGrants`** (`@objectstack/spec` contract, served by `@objectstack/plugin-security`) is optional. A security service without it serves the list undecorated, never with empty values.
- **`@objectstack/core`** exports `readPositionGrantsInForce` and `countPositionHolders`. `resolveUserAuthzGrants` now asks the same two rules for a caller, with no change in what it resolves.
