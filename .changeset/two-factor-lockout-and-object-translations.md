---
"@objectstack/platform-objects": patch
---

fix(i18n): ship the missing object-translation keys for the better-auth 1.7 and ADR-0105 D6 fields (#3624 follow-up)

The generated object-translation bundles predate two rounds of field additions,
so six fields had no entry in **any** locale and fell back to their raw schema
labels in every UI surface that reads the bundle:

- `sys_team.member_count`, `sys_team_member.membership_key`,
  `sys_two_factor.failed_verification_count` / `locked_until` — the better-auth
  1.7 columns provisioned in #3647.
- `sys_organization.parent_organization_id` / `sort_order` — the same gap left
  by the earlier ADR-0105 D6 group-structure work.

Regenerated with `os i18n extract` (merge mode, so every existing translation is
preserved — the diff is purely additive). No API or schema change; the fields
themselves already shipped.
