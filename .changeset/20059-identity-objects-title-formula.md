---
"@objectstack/platform-objects": patch
---

fix(platform-objects): ten identity objects declare their record title instead of having `nameField: 'id'` stamped on them (#20059)

Clause-②: no

ADR-0079 resolves a record's title as `nameField`, then `displayNameField`, then a derivation, and an explicit `nameField` takes precedence over the render-only `titleFormat`. Ten identity objects declared a `titleFormat` and no title pointer. The registry's designate-only pass derived `id`, the first title-eligible field on each of them, and stamped `nameField: 'id'`, and a `/meta` read serves that stamp as if it were declared. A renderer that follows ADR-0079's order therefore showed the raw record id as the record page's title.

Nine of them now declare `display_title`, a formula field with `returnType: 'text'` over the columns their `titleFormat` names, and point `nameField` and `displayNameField` at it:

- `sys_account`: `{provider_id} - {account_id}`;
- `sys_business_unit_member`: `{user_id} in {business_unit_id}`;
- `sys_invitation`: `Invitation for {email}`;
- `sys_member`: `{user_id} ({role})`. A row without a role is titled by its user alone;
- `sys_scim_group_member`: `{scim_user_id} in {group_id}`;
- `sys_scim_projection_grant`: `{role} → {user_id}`;
- `sys_team_member`: `{user_id} in {team_id}`;
- `sys_two_factor`: `Two-factor for {user_id}`;
- `sys_verification`: `Verification for {identifier}`.

This is the migration the `titleFormat` schema text prescribes: "a composite to a formula field designated as nameField". `sys_scim_subject` has a single-field title (`{user_id}`), so its `nameField` and `displayNameField` name `user_id` directly, as the same text prescribes for a single field.

A formula field is computed when a record is read. It adds no database column, so no schema migration runs. Record reads now carry `display_title` on the nine objects. A formula is evaluated on the stored row, so where a `titleFormat` names a lookup (`user_id`, `team_id`, `business_unit_id`, `group_id`, `scim_user_id`), the formula's text carries the stored id of the related record, not its name.

`titleFormat` stays on all ten objects, unchanged, for renderers that still read it first. `$search` resolution is unchanged: neither a formula field, a lookup nor `id` is ever a search target.
