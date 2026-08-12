---
"@objectstack/example-crm": patch
---

fix(example-crm): bind the three declared positions to `crm_sales_user` (#8060)

`examples/app-crm/src/security/sales-positions.ts` declared three positions
(`sales_rep`, `sales_manager`, `finance_approver`) and a `crm_sales_user`
permission set, but nothing ever joined them — the app seeded no
`sys_position_permission_set` rows, and `crm_sales_user` was not marked
`isDefault` (which would have granted every user, not just the three
positions). A user assigned any of the three positions therefore resolved
only the platform `everyone` baseline and was 403'd on every CRM object.

Mirrors `examples/app-showcase/src/security/bind-position-sets.ts`: a new
`examples/app-crm/src/security/bind-position-sets.ts` binds the three
positions to `crm_sales_user` imperatively on `kernel:bootstrapped` (a
declarative seed can't do this — the seed loader runs before the security
bootstrap creates the `sys_position`/`sys_permission_set` rows), wired via a
new `onEnable` export in `objectstack.config.ts`.

Measured with `objectstack verify --app examples/app-crm/objectstack.config.ts
--rls`: the three per-position probe personas went from 18-of-18
`probe-blocked` (no object grant at all — the by-id-write class was never
exercised) to 3 `probe-blocked` (one per persona: `crm_opportunity_line_item`,
which `crm_sales_user` does not grant — a separate, pre-existing gap, not
addressed here). Zero RLS holes introduced or found.
