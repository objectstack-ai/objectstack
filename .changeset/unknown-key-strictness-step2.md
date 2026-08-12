---
"@objectstack/spec": major
---

feat(spec)!: reject unknown keys on RLS policies, sharing rules, and positions (#4001 step 2)

Second click of the unknown-key strictness ratchet (first: flow + permission,
#4071), extending `.strict()` + the `strictUnknownKeyError` fixable-error
factory to the remaining small security-class authoring surfaces, per
`docs/audits/2026-07-unknown-key-strictness-ledger.md`:

- **`security/rls.zod.ts`** — `RowLevelSecurityPolicySchema` is `.strict()`.
  A silently dropped key on an RLS policy meant a row-level restriction the
  author wrote was never compiled into the filter. The runtime shapes
  (`RLSUserContextSchema`, `RLSEvaluationResultSchema`) stay tolerant. The
  retired `priority` key keeps its existing tombstone.
- **`security/sharing.zod.ts`** — the sharing-rule surface is `.strict()`
  (base + criteria extension + the `sharedWith` recipient shape). A silently
  dropped key meant a share the author intended was never materialised.
- **`identity/position.zod.ts`** — `PositionSchema` is `.strict()`, and gains
  the author-facing `protection` block plus the ADR-0010 runtime protection
  envelope (`_lock`, `_packageId`, `_provenance`, …) — closing the sibling
  gap the #4071 ledger flagged: `applyProtection` stamps every registered
  metadata type, and position was the last one whose schema could not
  represent the stamp.

**Migration.** Any key these schemas now reject was previously stripped and
had **no runtime effect** — removing or renaming it never changes behavior.
The error carries the fix; FROM → TO mappings baked in include:

- RLS policy: `roles`/`role` → `positions` (ADR-0090 D3 rename),
  `withCheck` → `check` (the PostgreSQL spelling), `condition`/`filter`/`where`
  → `using`. `priority` stays a tombstone (#3896: OR-combined policies have no
  precedence to order — delete the key).
- Sharing rule: `criteria` → `condition` (the persisted row spells the
  compiled predicate `criteria_json`; the authored key is the CEL
  `condition`), `access`/`level` → `accessLevel`,
  `recipient`/`shareWith`/`sharedTo` → `sharedWith`, `enabled` → `active`;
  recipient `id`/`target` → `value`. `ownedBy` carries the removed
  owner-type-rule prescription (only `criteria` rules are authorable).
- Position: `title` → `label`; `permissionSets` / `users` are runtime
  bindings (`sys_position_permission_set` / `sys_user_position`), never
  authored on the position; `parent` is rejected with the flatness rule
  (ADR-0090 D3 — hierarchy is the business-unit tree, not a position tree).

<!-- adr-0087: registered authoring-schemas-strict-unknown-keys -->
