---
'@objectstack/platform-objects': minor
---

fix(platform-objects)!: deleting a business unit that still has child units is refused, instead of silently turning each child into a root of the tenant

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) One shipped object field, `sys_business_unit.parent_business_unit_id`, gains `deleteBehavior: 'restrict'`, a key every lookup was always free to set, and its help text says what that means. No spec key, authorable spelling, export, type or stored shape is added, removed or renamed, and no stored row or column is read or rewritten, so `objectstack migrate meta` has nothing to rewrite. What narrows is the accept set of one delete: a business unit that still has child units is refused where it was accepted. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id covers this field (not already-registered or registered); and the change is metadata on a shipped object, not an interface, a type or an export (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (the delete of a business unit with children is refused), shipped as `minor` under the launch-window convention for accept-set narrowings.

- **FROM:** `parent_business_unit_id` declared no `deleteBehavior`, so it took the lookup default `set_null`. Deleting a business unit that had child units answered `200`, and each child's `parent_business_unit_id` became `null`: a root of the tenant, without a word. A `unit_and_subordinates` sharing rule anchored above the deleted unit stopped reaching the former children.
- **TO:** the same delete answers `409 DELETE_RESTRICTED`, naming the blocking object (`dependentObject: 'sys_business_unit'`) and the number of child units (`dependentCount`), with the sentence "This Business Unit is still referenced by N Business Unit record(s) through “Parent Business Unit”. Delete or reassign them first." The unit and its children are left exactly as they were. The field's help text now says a unit with child units cannot be deleted until they are re-parented or deleted.
- **Unchanged:** a unit with no child units deletes as before. A bulk delete (`deleteMany`, `batch`) that lists the children before their parent (leaf to root) completes, atomic or not. Deleting an organization leaves its units and their tree in place, as before.
- **Fix:** before deleting a business unit, re-parent its child units (edit each child's Parent Business Unit) or delete them first. A bulk delete of a whole subtree lists the units leaf to root; listed root first, the root is refused.
