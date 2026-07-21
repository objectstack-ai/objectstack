---
"@objectstack/platform-objects": patch
---

fix(platform-objects): allow import/export on sys_business_unit_member (#3025 / #3391 P0)

Completes the #3025 point-fix. #3392 unblocked `sys_business_unit`'s Import/Export
buttons (405 `OBJECT_API_METHOD_NOT_ALLOWED`) by adding `'import'`/`'export'` to its
`enable.apiMethods` whitelist, but the HRIS org-tree sync scenario imports **two
tables together** — the units *and* their memberships — and the sibling
`sys_business_unit_member` was left on the CRUD-only whitelist, so the membership
Import/Export path still 405'd. #3391's P0 checklist pairs both tables; this is the
half #3392 missed.

- `packages/platform-objects/src/identity/sys-business-unit-member.object.ts`:
  `apiMethods` gains `'import'`, `'export'`. Import reuses the object's
  already-granted create/update affordances; export is a bulk read.
- Reconcile-safe: the object is `managedBy:'platform'`, but
  `reconcileManagedApiMethods` only strips generic write verbs
  (`create/update/upsert/delete/purge` — `MANAGED_WRITE_VERB_AFFORDANCE`). It never
  touches `import`/`export`, so the declared whitelist reaches the REST gate intact
  (no false-green: the static whitelist the regression test asserts IS what
  `apiAccessDenialFromEnable` enforces at runtime).
- Regression test (`platform-objects.test.ts`) locks `import`/`export` presence and
  CRUD retention. Proven red-before-green: reverting the object edit fails with
  `expected [...] to include 'import'`.

Transitional: #3391 P2 replaces per-object `import`/`export` declarations with a
single derived mapping (import ⊆ create/update, export ⊆ list) and reclaims the
explicit entries on both business-unit objects together.

Refs #3025, #3391.
