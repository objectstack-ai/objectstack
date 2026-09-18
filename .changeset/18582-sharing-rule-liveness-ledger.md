---
"@objectstack/spec": patch
---

`liveness/sharing_rule.json` — the sharing-rule authoring surface is now a governed liveness type: every authorable key of `SharingRuleSchema` carries a status, the evidence that settles it and the producer that populates it (part of #18582).

The ledgers ship inside this package (`files[]` includes `liveness`), so this is a new file in the tarball and two changed ones — `liveness/README.md`'s index row and the generated `liveness/state-counts.md`. Nothing else moves: no schema accepts or refuses anything it did not before, no export changes, and no CLI author warning is added (no entry is marked `authorWarn`).

- **Why it was ungoverned.** `sharing_rule` is bound in `UNREGISTERED_KIND_SCHEMAS`, which `listMetadataTypeSchemaTypes()` deliberately does not enumerate, so it sat in **neither** `GOVERNED` **nor** `PENDING_GOVERNANCE` and produced no row in any of the gate's lists while the report read complete. Widening the governance denominator to the authorable set made it visible as a declared debt; this pays that debt. `connector` and `analytics_cube` are still owed.
- **Every row cites a producer, because the authoring shape is not the enforced shape.** ADR-0057 D6 makes the `sys_sharing_rule` row canonical — `object_name` + `criteria_json` + `recipient_type`/`recipient_id` + `access_level` — and `bootstrapDeclaredSharingRules` translates each authored key into it at boot. Nothing re-parses `SharingRuleSchema` at enforcement time, so a consumer pointer alone would prove only that a column is read, never that the authored value reaches it.
- **Nine keys are `live`; one is `planned`.** `type` is the `SharingRuleType` discriminator: one member, `criteria`, whose only reader in this repo is a defensive `=== 'owner'` comparison that is unreachable for every value the schema admits. It is deliberately **not** `dead` and therefore not an enforce-or-remove candidate — the key is required, so removing it would break every authored rule to delete nothing, and the schema keeps it as the discriminant for a future enforced rule type.
- **`sharedWith` is drilled**, so the two recipient keys carry their own verdicts and the change adds no row to the undrilled-container baseline.

For an author, the practical read: `name`, `object`, `active`, `accessLevel`, `condition` and both `sharedWith` keys change what the runtime grants; `label` and `description` are display-shaped and are shown in Setup; `type` has exactly one legal value and, today, no dispatch behind it.
