---
'@objectstack/spec': minor
---

**BREAKING for authored metadata** — a delegated-admin scope's `businessUnit` (`AdminScopeSchema`, reached as `adminScope.businessUnit` on a permission set) must now name a business unit. An empty or whitespace-only value is refused at parse, at the key's own path, with a message naming what a valid anchor is: the `sys_business_unit.name` of the root of the delegated subtree (#19461).

Clause-②: yes

Maintainer ruling A on decision batch #217 item 1, 2026-09-23 「217 同意」.

## What changed, and why

`businessUnit` is the scope's one required key, and every other key of the scope is scoped to it. It was declared as a bare string with no minimum, so `{ businessUnit: '' }` and `{ businessUnit: '   ' }` parsed green: the requirement was satisfied by a value that names no business unit. The delegated-admin gate looks the anchor up by exact name, so a blank anchor resolved to an empty subtree. No escalation was measured; the defect is a declaration that did not enforce what it declared. The likeliest author of a blank anchor is an AI that knew the key was required and did not yet know the unit, and until now the platform answered "accepted".

```
FROM  AdminScopeSchema.safeParse({ businessUnit: '' })
      -> { success: true }

TO    AdminScopeSchema.safeParse({ businessUnit: '' })
      -> { success: false,
           issues: [{ code: 'custom', path: ['businessUnit'],
                      message: 'A blank businessUnit is not a delegation boundary: businessUnit is
                                the sys_business_unit.name (machine name) of the business unit at
                                the root of the subtree this scope delegates, …' }] }
```

The refusal is a non-transforming refinement: nothing is trimmed. The metadata save path stores the submitted body as written, so a trimming schema would validate one string and store another. A real name parses byte-identical. The published JSON Schema states the same rule (`minLength: 1` and a non-whitespace `pattern`).

## Migration — FROM → TO

| You wrote | Write instead |
| --- | --- |
| `adminScope: { businessUnit: '' }` | `adminScope: { businessUnit: 'north_america' }`, using the machine name of the unit at the root of the subtree |
| `adminScope: { businessUnit: '   ' }` (or a tab or newline) | the same: the root unit's `sys_business_unit.name` |
| a blank-anchored scope on a set that should not delegate at all | remove `adminScope` from the permission set |

**The one-line fix: set `businessUnit` to the `sys_business_unit.name` of the business unit at the root of the delegated subtree, or remove `adminScope` if the set should not delegate administration.** This cannot be converted automatically, because a blank names no unit and the intended root cannot be inferred. So this ships as an ADR-0087 D3 structured TODO with **no D2 conversion**.

<!-- adr-0087: registered admin-scope-business-unit-blank-refused -->

## Stored permission sets

- **Stored scopes are not rewritten.** Reads do not re-validate stored rows, so no stored permission set becomes unreadable. A stored blank anchor loads and resolves exactly as before.
- **The next write refuses it.** A Setup or data-door edit of a permission set whose stored scope has a blank anchor answers `422 INVALID_METADATA` naming `adminScope.businessUnit`, until the anchor is named or the scope removed.
- **The boot reconciliation backfill reports it.** A legacy `sys_permission_set` record with no metadata definition and a blank anchor is not backfilled. It is reported on every boot through the existing ADR-0094 D4 durability `ERROR`, which names the record and the offending key, until the record is fixed or deleted. Restoring a trashed blank-anchored set brings the record back and reports the missing definition at `ERROR` the same way. No path skips the row.
- **A clean boot is not a completed sweep.** A definition already stored in `sys_metadata` says nothing until it is written again, so search stored permission sets and the `admin_scope` column for a blank `businessUnit`.

## What does NOT change

- **An absent `businessUnit`** is refused exactly as before, with its own `invalid_type` issue.
- **A real name with surrounding whitespace** is not judged by this change. It parses and is stored byte-identical.
- **The other keys of the scope** (`includeSubtree`, `manageAssignments`, `manageBindings`, `authorEnvironmentSets`, `assignablePermissionSets`) are untouched.
- **The published export surface.** No export is added, removed or renamed, and the `AdminScope` / `AdminScopeParsed` types are unchanged.
