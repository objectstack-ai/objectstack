---
"@objectstack/lint": minor
---

feat(lint): report `sharingModel: controlled_by_parent` with nothing to derive access from (#7503)

An object that declares `controlled_by_parent` and gives the platform no
relation to derive access from is a metadata defect, and until now nothing said
so before the app was in someone's hands. Both runtime halves of ADR-0055
already refuse the shape — reads resolve to a deny-all filter, and writes are
refused with `422 INVALID_METADATA` (`MasterDetailRelationMissingError`, added
in #7474) — but only when a caller happens to touch the object. The defect
exists from the moment the metadata is authored, which is where it is now
reported.

**New rule — `security-controlled-by-parent-no-relation` (`error`).** It fires
on an object whose `sharingModel` is `controlled_by_parent` and which matches
none of the three shapes the runtime's `resolveCbpRelation` resolves: a
`required` `master_detail`, else any `master_detail`, else a `required`
`lookup` — each of which must also name a `reference` target. Anything the
runtime resolves stays silent, including the `master_detail` an author left
un-`required`.

`error`, not advisory, by the criterion the security linter states for itself
(ADR-0090 D7 / ADR-0049): every `error` rule mirrors a runtime enforcement
point, and this one mirrors a hard refusal exactly. The defect is also a
self-contained property of the object document — unlike the advisory rules in
this family, there is no per-permission-set nuance the linter cannot adjudicate
and no reading under which the object works.

It matters most for AI-authored metadata: `controlled_by_parent` next to a
`lookup` nobody marked `required` is a plausible thing for an agent to write,
and nothing in the authoring loop used to say so.

Runs on the `os compile` / `os lint` / `os validate` CLI surface, alongside the
rest of `validateSecurityPosture`.
