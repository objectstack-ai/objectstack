---
"@objectstack/plugin-sharing": minor
"@objectstack/rest": patch
"@objectstack/spec": patch
---

fix(security)!: a sharing rule with no criteria now shares NOTHING instead of every record (#3896)

`SharingRuleSchema` has always required `condition`, and its doc is explicit
that a predicate the compiler cannot lower is *"skipped and logged — never
seeded as a permissive match-all (ADR-0049)"*. The declared/seed path honoured
that. The two other ways to create a rule did not:

- **`POST {basePath}/sharing/rules`** plucks its body field-by-field into
  `SharingRuleService.defineRule`, which validated `name` / `label` / `object` /
  `recipientType` / `recipientId` — and not `criteria`. A missing, `null`, or
  **misspelled** key (`criterias`) was stored as `criteria_json: null`, answered
  `201` with no warning, and evaluated as
  `find(object, { filter: {}, context: SYSTEM_CTX })`: every record of the
  object, up to 5000, granted to the recipient. Triggering it took a typo, not
  an attacker.
- **Authoring a rule in Setup** is a direct `sys_sharing_rule` insert, which
  never reaches `defineRule` at all.

Empty criteria is now rejected everywhere a rule can be written, and — because
rules created before this gate are already in the table — the evaluator refuses
to act on one regardless of how it got there.

- **`defineRule` rejects a match-all criteria** with
  `VALIDATION_FAILED: criteria is required …`, alongside its other required
  fields. Covers the REST endpoint, programmatic callers, and the seeder.
  Rejected shapes: missing / `null` / `''` / `{}` / `[]` / `{ $and: [] }` /
  unparsable JSON (e.g. a CEL source typed into the Criteria box).
- **The evaluator matches nothing** for such a rule and logs why, so a row
  stored before this release under-shares instead of over-sharing: the next
  reconcile *revokes* the grants it had materialised. Both evaluation paths are
  covered — the bulk `evaluateRule` and the per-record write-hook path.
- **`bindRuleCriteriaGuard`** fails `sys_sharing_rule` inserts with no
  criteria as a field-level `VALIDATION_FAILED` (a 400 naming `criteria_json`),
  so the Setup path reports the problem instead of saving an inert rule
  (ADR-0078). Updates are checked only when the patch supplies
  `criteria_json` — switching an over-broad legacy rule off must not require
  inventing a criteria for it first.
- **The seed bootstrap's "empty condition = match-all" branch is gone**: a
  missing or empty `condition` is now skipped and logged like any other
  non-lowerable one.
- `POST {basePath}/sharing/rules` also accepts `criteria_json` as an alias for
  `criteria`, matching the snake_case aliases the endpoint already takes for
  `object_name` / `recipient_type` / `access_level`.

**Migration.** There is no "share every record" sharing rule, and there never
usefully was one — the shape existed only as a failure mode. A rule that
relied on it must state its predicate (`criteria: { stage: 'won' }`), or, if
the object really should be readable by everyone, use the object's
organization-wide default (`sharingModel`) instead. Rules already stored with
a null `criteria_json` need no data migration: they stop granting on the next
evaluation and their existing grants are revoked.
