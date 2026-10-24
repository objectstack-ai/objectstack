---
'@objectstack/spec': minor
'@objectstack/metadata-core': patch
---

feat(spec): a roster object can declare its membership keys, `ObjectSchema.membershipKeys`

Clause-②: yes (widening)
Metadata-protocol: added

`ObjectSchema` gains one optional key, `membershipKeys`: the `current_user.KEY` sets this object defines, by name, the metadata twin of the registered membership resolver (ADR-0105 D11). `current_user.KEY` is to be the distinct values of `valueField` on this object's rows whose `userField` is the signed-in user and on which the optional `filter` holds, so a permission set's row policy can read `supplier in current_user.portal_supplier_ids` instead of a stamp on every record. The entry shape is exported as `MembershipKeySchema` from `@objectstack/spec/security` (types `MembershipKey` and `MembershipKeyParsed`), with the map `MembershipKeysSchema` (`MembershipKeys`, `MembershipKeysParsed`), the name rule `MembershipKeyNameSchema` (`MembershipKeyName`, `MembershipKeyNameParsed`) and the platform bound `MEMBERSHIP_KEY_MAX_VALUES` (1,000).

- **What it parses.** `userField` and `valueField` (required column names), `filter` (CEL over this object's own columns), `label` and `description`.
- **What it refuses.** Any other member (`object`, which is implied, and an authored size such as `limit`, each with a prescription); a key name that is not snake_case or is one of the kernel's own context names (`id`, `organization_id`, `positions`, `org_user_ids`, `accessible_org_ids`, `email`); `valueField` naming the same column as `userField`; and `membershipKeys` on an object extension, so a key can only be declared by the package that owns the roster object.
- **`defineStack` and `composeStacks`** refuse one key declared on two objects, in the cross-reference envelope (`STACK_CROSS_REFERENCE_INVALID`, 422): a key name is one request-wide name. Under `objectConflict: 'merge'`, two stacks declaring a different `membershipKeys` on one object are refused like every other object-level collection.
- **What it does today: nothing.** No server reads the key in this release, so a policy reading a declared key matches no rows, as it would for any key nothing supplies. Authoring the key raises the liveness lint's `liveness-planned-property` warning until the security plugin stages it. Scope rows with positions or a registered membership resolver in the meantime.
- **`@objectstack/metadata-core`: the field-level-security projection classifies the new key.** When an object document is served to a caller who cannot read some of its fields, each membership key whose `userField`, `valueField` or `filter` names such a field is dropped whole from the served document; the others are served unchanged.
- The row-level security docs no longer say the runtime stages `territory_account_ids` or `team_member_ids`: those are app-supplied keys, and the docs now say where a membership key comes from.
- Additive: every object that parsed before still parses, and its parsed output is unchanged.
