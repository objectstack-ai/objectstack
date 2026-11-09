---
'@objectstack/platform-objects': patch
'@objectstack/core': patch
---

fix(platform-objects): an organization membership, a two-factor enrollment and the two SCIM join rows are named by the people and groups they point at, not raw ids

Clause-②: no
Metadata-protocol: none

- **The record titles.** Four identity join objects built their title (`display_title`) by splicing stored lookup ids, so a record page's heading, a list's Title column and every reference to the row read ids. Each now reads names one hop through its lookups (ADR-0079 addendum, 2026-10-18), as `sys_business_unit_member` and `sys_team_member` do. A person is their `name`, or their `email` where the name is blank:
  - `sys_member`: `Ada Lovelace (admin)`, or `Ada Lovelace` with no role;
  - `sys_two_factor`: `Two-factor for Ada Lovelace`;
  - `sys_scim_projection_grant`: `billing_admin → Ada Lovelace`;
  - `sys_scim_group_member`: the provisioned user's `user_name` and the group's `display_name`, each its object's own title: `ada.lovelace@idp.example in Operations`.

  Every hop is read as the reader: a person, provisioned user or group the reader may not read, or one that no longer exists, leaves the title empty rather than showing an id. No column is stored, so a rename shows on the next read.
- **The authorization prelude reads no title.** `@objectstack/core`'s grant resolver reads `sys_member` three times (the caller's memberships, the active organization's first page of members, and the position-holder count). Each read now names the columns it decides on, as the `sys_user_permission_set` grant read already did, so the membership's title, which now reads a `sys_user` row, is never computed there. An authenticated request still pays the same reads and round trips as before.
