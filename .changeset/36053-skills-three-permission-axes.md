---
'@objectstack/skills': patch
'@objectstack/spec': patch
---

docs(skills): the data skill teaches the three permission axes, `viewAllFields` and the sensitivity tiers

Clause-②: no
Metadata-protocol: none

objectstack-data's `rules/security.md` now teaches the permission model in three axes. Object permission (`allowRead`, `allowCreate`, `allowEdit`, `allowDelete`) decides whether the caller can use the object at all. Record scope (`viewAllRecords`, `modifyAllRecords`) widens which records the caller reaches, and from v19 those two bits open no field. Fields are visible by default, so an author writes only the exceptions: nothing for an ordinary field, `fields` rows in the sets that differ for a role-dependent one, and `requiredPermissions` on the field itself for a high-sensitivity one (salary, ID numbers), with `maskingRule` where a partial value is needed. That gate is strictest-wins over every field row, `viewAllFields`, View All and Modify All.

A new section teaches `viewAllFields: true` as the way to say "this role reads every field", for admin-like sets: a read vote on every field, fields added later included, and never an edit vote; the set's own `readable: false` row beats it; it grants no object access and widens no record; on the `'*'` entry it also votes on the fields of private-posture objects, which a plain `'*'` does not grant; it is authored in metadata, as Studio's permission matrix keeps the key and has no control for it.

`evals/hooks-security-seeds-datasources.json` gains two cases: a read-everything auditor set written with `viewAllFields`, and salary and ID-number fields gated with `requiredPermissions` and `maskingRule`. Two restatements in `rules/security.md` were removed to pay for part of the new text (the "Locks, never grants" bullet and the recipe link of the `when` section).

`@objectstack/spec`: two docblock sentences in `src/security/permission.zod.ts`, comments only. The `viewAllFields` docblock now says the key changes nothing on an object entry that carries View All or Modify All (it said "on a set"), and the `FieldPermissionSchema` docblock names `viewAllFields` beside the super-user bits as a voter in the field merge. No schema, description or generated artifact changes.
