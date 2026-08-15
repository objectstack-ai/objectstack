---
"@objectstack/plugin-security": minor
"@objectstack/spec": minor
---

fix(security): the shipped admin permission sets no longer grant export on the `*` wildcard (#8681)

<!-- adr-0087: registered admin-export-wildcard-removed -->

**BREAKING for any deployment whose administrators export today.** Landing after
the v17.0.0 cut, so it ships as `minor` under the lockstep launch-window
convention; the migration prescription is registered under protocol major 18,
where `objectstack migrate meta` users will look.

`admin_full_access`, `organization_admin` and the derived
`organization_admin_no_bypass` shipped `objects['*'].allowExport = true`. That
single line made the 17.0 export axis **undeniable** for anyone holding an admin
set: an application could declare an object exportable by nobody, ship it, and
the platform would export it anyway.

Measured on 17.0.0 GA — 40 export probes, 5 principals, 8 objects, real Bearer
tokens — an org owner exported `crm_quote` (9 rows), `crm_campaign` (13) and
`crm_task` (15) with 200 and full data. No app permission set granted export on
any of the three, and the app had no way to say no:

1. the wildcard lives in code-package metadata, so editing it answers
   `403 [not_overridable] Metadata item 'permission/admin_full_access' is
   provided by a code package`;
2. the org admin holds no app-authored permission set, so there is nowhere to
   author the per-object `allowExport: false` that would otherwise have won.

**This was never a gate defect.** The same run proves the export gate exact for
every other principal: a token refused on one object exports another on the same
route, granting `allowExport` at runtime flips 403 to 200, and revoking it flips
it back. A plain member carrying `'*': { allowExport: true }` exported too — the
wildcard was simply doing what it said. What changes is that the platform stops
shipping that grant.

This is #5491 applied to the export axis. That change removed `member_default`'s
CRUD wildcard because a wildcard in a set every principal resolves is not a
default but a floor no app can get under; the export wildcard survived by
omission rather than by decision, one tier up.

**Migration — grant `allowExport` explicitly in an app permission set where
admin export is intended.** There is no automatic replacement, deliberately:
which principals may take a bulk machine-readable copy of a table is the
segregation-of-duties judgement the axis exists to make explicit.

```ts
// In YOUR app's permission set — not a platform set (those are not overridable).
{
  name: 'system_admin',
  objects: {
    crm_account: { allowRead: true, allowExport: true },  // export intended
    crm_quote:   { allowRead: true },                     // export withheld
  },
}
```

⚠️ **Nothing fails at parse time, and the shipped sets are re-seeded on
upgrade.** A deployment that upgrades without editing anything is valid metadata
whose administrators have quietly lost export on every object no app set names —
the first sign is a support report, not an error. Verify behaviourally: sign in
as an org owner and call `GET /api/v1/data/<object>/export`, expecting 200 where
export is intended and 403 `EXPORT_NOT_PERMITTED` where it is not.

**What is deliberately unchanged.** READ is untouched — an admin still sees
every record they saw before; this narrows bulk egress only. `allowExport` on a
`'*'` entry remains a supported, honoured authoring shape in an app's own sets.
Specific-over-wildcard precedence is unchanged (an explicit per-object entry
still overrides the wildcard). The `viewAllRecords` / `modifyAllRecords`
super-user bits still do not imply export, exactly as before. And an app's own
admin set already gets precisely its declared posture — declared `false` answers
403, declared `true` answers 200 — which is what makes withdrawing the platform
grant safe rather than merely restrictive.

Both admin sets are fixed together, and the org-admin pair from one declaration
(`organization_admin_no_bypass` is derived from `organization_admin`). Fixing
one and not the other was rejected outright: a half-closed export boundary reads
as closed and is not.
