---
"@objectstack/plugin-security": patch
---

fix(plugin-security): withdraw the `sys_capability` Deactivate dialog's false promise that deactivation revokes access (#8535)

**A shipped confirmation dialog's promise is being withdrawn.** The
`deactivate_capability` action told the admin, verbatim:

> Deactivate this capability? Grants and resource requirements that reference it
> stop resolving until re-activated.

No code path has ever enforced that. `PermissionEvaluator.getSystemPermissions()`
unions `permissionSets[].systemPermissions` — plain strings — and a resource's
`requiredPermissions` is matched against that string set. Neither loads a
`sys_capability` row. The table's only two production readers are the seeders
(`bootstrap-system-capabilities.ts`, `bootstrap-declared-capabilities.ts`), which
**write** `active: true` on insert and never read it back.

**What `active` actually means now, stated plainly:** it is a catalogue /
visibility flag. It marks a row inactive for filtering and review in Setup, and it
has **no authorization effect whatsoever**. Deactivating a capability revokes
nothing — permission sets that grant it and resources that require it match it by
name and keep resolving exactly as before.

The direction of the old falsehood was the dangerous one. An admin withdrawing a
capability was told the withdrawal took effect, and it silently did not — the
escalation is what they believed they had prevented. This is ADR-0049
enforce-or-remove; per the maintainer ruling of 2026-08-13 the claim is
**withdrawn, not enforced**. Putting the capability registry on the authorization
hot path is an architectural change — caching, fail-closed semantics, org-authored
rows influencing platform capabilities — that must arrive as a designed feature
with its own card if capability lifecycle management ever earns real pull, not as
a side effect of wiring up one field.

Changes, all presentation and text — no behaviour changes, because there was no
behaviour to change:

- the confirmation dialog now states the non-effect outright rather than merely
  omitting the promise: an admin who remembers the old wording has to be told it
  was wrong, not left to infer it;
- the same correction is made in **all four shipped locales** (`en`, `es-ES`,
  `ja-JP`, `zh-CN`). Editing the source object does **not** rewrite shipped
  bundles — the extractor preserves existing leaf values, so a changed string
  stays stale in every locale until corrected by hand;
- `active` gains a `description` it never had, declaring its real semantics
  including the negative half. Its absence is how the dialog became the only place
  the field's meaning was stated — and that statement was false;
- `active` is demoted from `highlightFields`, from the `danger` action variant,
  and from the two scoped list views, and stays in the full-catalogue view where a
  catalogue attribute belongs. A truthful dialog under a field still presented as
  first-class tells the admin the flag matters after all.

Admins who deactivated a capability expecting access to stop should be aware that
access never stopped, and should withdraw the grant itself (the permission set's
`systemPermissions`) instead.
