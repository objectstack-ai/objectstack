---
"@objectstack/example-crm": patch
---

fix(example-crm): grant `crm_opportunity_line_item` in `crm_sales_user`, matching its master `crm_opportunity` (#8164)

`crm_opportunity_line_item` is a master-detail CHILD of `crm_opportunity`
(`sharingModel: 'controlled_by_parent'`, `inlineEdit: 'grid'` on the
Opportunity form), but `crm_sales_user` — the app's only non-guest
permission set — granted object-level CRUD on 5 CRM objects and never the
line item. Record-level access always follows the master (ADR-0055), but
object-level CRUD is a SEPARATE gate the platform never derives: every
role-bound (non-admin) user, including the three positions this app ships
to demonstrate selling, got a silent 403 the moment they tried to add or
edit a product line on an Opportunity they otherwise fully own. The
platform's own build-time lint (`security-master-detail-ungranted`) already
flagged this independently.

Added `crm_opportunity_line_item` to `crm_sales_user`'s `objects` map with
the exact same grant shape as its master `crm_opportunity`
(`{ allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false }`)
— the line item's own access is meant to follow its master, not invent an
independent policy.

Measured with `objectstack verify --app examples/app-crm/objectstack.config.ts
--rls`: every position persona's `probeBlocked` count dropped from 1 (the
line item, the sole remaining gap left open by #8060) to 0, with zero RLS
holes introduced or found. The build's `security-master-detail-ungranted`
warning for this object is gone.
