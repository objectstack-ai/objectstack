---
'@objectstack/platform-objects': patch
---

feat(platform-objects): the System Overview datasets give their seven members synonyms and a description

Clause-②: no
Metadata-protocol: none

The five System Overview datasets (`sys_user_metrics`, `sys_organization_metrics`, `sys_session_metrics`, `sys_package_installation_metrics`, `sys_audit_log_metrics`) had no business words on their seven members. A question asked in an administrator's own words therefore found only a member's name or its label in the caller's locale. Each member now declares ADR-0149 D1 `synonyms`, Chinese and English in one array, and a one-sentence `description`:

- measures `user_count`, `org_count`, `session_count`, `package_count`, `event_count`;
- dimensions `action` and `user_id` on `sys_audit_log_metrics`.

Synonyms are match input, so no bundle translates them. Each description has a bundle entry at `datasets.<name>.{measures,dimensions}.<member>.description` in all eleven Setup bundle locales, and a recorded source digest in each translated locale.

`list_datasets` compares a term by equality after normalization. So `list_datasets({ terms: ['用户数'] })` and `list_datasets({ terms: ['how many users'] })` now each match `sys_user_metrics.measures.user_count` on a synonym, and nothing else. A word that no member declares still matches nothing. No synonym is a word of another measure in any of the five datasets, in any locale.
