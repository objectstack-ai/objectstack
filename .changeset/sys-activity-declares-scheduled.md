---
'@objectstack/plugin-audit': patch
---

Declare `sys_activity.type: 'scheduled'` and record its writer in the type census

A shipped app action writes the value today. `objectstack-ai/hotcrm`
`src/actions/global.actions.ts` builds a `schedule_meeting` action for
`crm_lead`, `crm_contact`, `crm_account`, `crm_opportunity` and `crm_case`
whose body runs `ctx.api.object('sys_activity').insert({ type: EVENT_STATUS
=== 'held' ? 'completed' : 'scheduled', … })`, and `SCHEDULE_MEETING_SPEC`
declares `eventStatus: 'planned'`, so that action always takes the `scheduled`
branch. Read at hotcrm `5eee1bd` on 2026-08-24.

**Nothing accepts or rejects differently.** Every `sys_activity` field is
`readonly: true`, and `validateRecord` skips readonly fields on both the insert
and the update branch (`objectql/src/validation/record-validator.ts`), so the
`invalid_option` check that enforces a select field's declared options never
runs for one — measured here, not assumed: with the value added to the enum and
nothing else changed, exactly one of the package's 313 assertions moved, the
writer census below, which exists to force that row to be written. Every
behavioural case stayed green, including the one that inserts an undeclared
value into this very column and measures that it lands. Before and after, the
row is stored verbatim. What changes is that the declaration names the value
the platform stores, so the timeline filter offers it and the four generated
locale bundles carry a label for it (`已安排` / `予定` / `Programado`).

The census (`sys-activity-type-vocabulary.test.ts`) gains the writer row, which
is what forces this to be measured rather than asserted: adding a value to the
enum without inventorying its writer fails that pin. Two further facts are
recorded there in passing — `completed` has a second writer at the same app
(`src/actions/contact.actions.ts`), and the census's in-repo sweep cannot see
either of them, because an app's server-side action reaches this column directly
through `ctx.api`.
