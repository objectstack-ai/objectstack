---
"@objectstack/lint": minor
---

feat(lint): a sharing rule anchored where sharing has nothing to widen is now an authoring-time error (#9698)

`validateSharingRuleEnforceability` gains its second arm. It already judged a
sharing rule's `condition` against the compiler that lowers it; it now judges
the rule's `object` against the verdict that decides whether the grant can
exist at all.

Two new `error` ids, both decidable from authored metadata before anything
boots, and both mirroring `SharingService.inertGrantReason` (ADR-0111 D7)
rather than modelling it:

- **`sharing-rule-object-not-shareable`** — the anchor object's effective
  sharing model is `public` (an explicit `sharingModel: 'public_read_write'`,
  or no `sharingModel` on a system object, which ADR-0090 D1 resolves to
  public). Sharing only ever WIDENS an OWD baseline, so on the widest baseline
  there is nothing to widen.
- **`sharing-rule-object-controlled-by-parent`** — the anchor is a
  master-detail detail, whose visibility is derived from its master
  (ADR-0055). It gets its own id and its own fix-it ("share the master
  record instead"), because `effectiveSharingModel` collapses it onto the same
  `public` verdict while the correct repair is completely different.

Both were previously accepted by `SharingRuleSchema`, accepted by `defineRule`,
seeded into `sys_sharing_rule`, and only then refused — once per boot, as a
WARN line inside the boot diagnostics block. That WARN is not a sufficient
diagnostic, and the reason is measured rather than argued: a rule whose criteria
match no seeded row never reaches `grant`, so it never throws and warns nothing
while being exactly as dead. The WARN is a function of the DATA; the defect is a
property of the DECLARATION.

**Blast radius, measured through `objectstack build` before deciding the
severity:** 5 sharing rules are declared in this repo. 3 fire, all of them in
`examples/app-crm` — `share_high_value_opps_with_managers`,
`share_active_leads_with_manager` and `share_won_deal_activities`, anchored on
`crm_opportunity`, `crm_lead` and `crm_activity`, every one of them
`sharingModel: 'public_read_write'`. They have been failing their boot backfill
on every boot of that app since they were written, and they are removed here
under ADR-0049 enforce-or-remove — the same call #9237 made for the two
equivalent rules in `app-showcase`. The other 2 (app-showcase's, both on
`private` objects) stay silent, which is the direction that had to be proven
rather than hoped for.

The CRM's smoke test used to assert that these rules existed and were of the
enforced `criteria` type. Both assertions passed while all three rules enforced
nothing, so the assertion is replaced by the property their greenness hid: no
declared rule may be anchored where sharing has nothing to widen.

Deliberately NOT judged, because they are not decidable from authored metadata:
the `owner_id` arm (`owner_id` is injected by the schema registry, so asserting
it would fail every object that correctly does not declare it by hand), the
`bypassObjects` arm (plugin configuration, not stack metadata), and the
federated phantom-anchor arm (a provenance test over that same injected column).
