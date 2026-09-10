---
"@objectstack/plugin-security": minor
---

feat(plugin-security): a position row can no longer spell an ADR-0068 built-in identity name (#15972)

`sys_position.name` and `sys_user_position.position` were unconstrained, so a tenant could mint a row spelling any framework-reserved built-in identity name — `platform_admin`, `org_owner`, `org_admin`, `org_member`. PR #15948 closed every in-repo READER that turned such a name into authority; it could not stop the row existing, and a reader is not an invariant: an out-of-repo consumer that reads the NAME instead of the capability rung reopens the hole with nothing mechanical to catch it.

Both declarations now carry an object-level `validations[]` rule whose CEL list literal is **generated** from `BUILTIN_IDENTITY_NAMES`, the `@objectstack/spec` constant that declares the identities. The set is a closed enumeration — imported, never retyped, and never widened to an `org_*` pattern, so an ordinary tenant position named `org_manager` still writes. Object-level validations are evaluated by the engine on insert, by-id update and multi-row update, so the data API, the seeders and metadata import are all covered by one refusal carrying one code (`VALIDATION_FAILED`).

Two doors, two shapes, for a reason:

- **`sys_position`** exempts the platform's own catalog provenance (`managed_by` of `platform`, or its legacy `system` spelling). `bootstrapBuiltinRoles` seeds exactly these four names per organization on purpose, and that catalog is unaffected. A `package`- or tenant-authored row is refused.
- **`sys_user_position`** takes **no** exemption. No writer in any package creates an assignment row spelling a built-in identity name — `platform_admin` standing comes from the unscoped `admin_full_access` grant, the `org_*` trio from `sys_member.role` — so every such row is a name pretending to be an identity.

Existing rows are not migrated and nothing rewrites them (maintainer ruling: refuse new writes only). The rule is an INVARIANT, so a row that already spells a reserved name is refused on any edit until it is renamed — frozen, not bricked. `scripts/measure-reserved-identity-name-census.mjs` is the read-only census that reports such rows from an operator-supplied export.

Housekeeping this change drags along, disclosed because a reviewer should not have to discover it: a validation rule's `name` is snake_case by contract, and `scripts/tenant-audit-census.mjs` counts every snake_case `name:` literal in a `*.object.ts` as a "declared object" (it already counts the four `actions[]` names on `sys_position`, so that figure was never a count of objects). The two new rule names move it 298 → 300, so the census artefacts are regenerated with the script's own `--write`. That block regenerates **whole**, so it also refreshes two figures this diff did not cause — `tracked non-test sources scanned` 557 → 562 and `engine-shaped types recognised` 59 → 58 — which are drift accumulated since the block was last measured at `9cefca9a3`.
