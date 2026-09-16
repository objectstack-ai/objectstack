---
'@objectstack/spec': patch
---

fix(spec): record the shipped `sys_job` / `sys_report_schedule` IANA narrowing in the ADR-0087 ledger (#16421)

Clause-②: no

`#16296` gave `sys_job.timezone` and `sys_report_schedule.timezone` the
`valueDomain: 'iana_time_zone'` declaration. That is a write-time narrowing — a
string these columns used to accept is now refused with the ADR-0114 field code
`value_domain` — and it shipped with no breaking-change marker at all, so the
repo's own detector classified it non-breaking and asked for no ADR-0087
disposition. Measured on the shipped changeset, not inferred.

The ledger now carries a `semantic` entry for it
(`platform-timezone-columns-iana-domain-refused`, protocol 18). Nothing is
re-released and nothing is ratified in silence: the entry states what narrowed,
the one-line fix per offending row (write the canonical zone id, or clear the
column), and the fact that a stored non-member is still readable and still
returned unchanged — it fails only on the row's next write. For
`sys_report_schedule` that refusal is the point: a non-member zone was silently
discarding the cron expression and falling back to `interval_minutes` forever.

No authorable key, export, config field or stored shape moves, and no DDL is
planned — this is a record of a change that already shipped, published so that
`objectstack migrate meta`'s consumers can read it.

Maintainer ruling, director summon #17, decision batch #2 item 1, option B
(#16421 comment 5572145955, 2026-09-07), quoted verbatim and untranslated: 「同意」.
