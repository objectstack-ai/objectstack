---
'@objectstack/trigger-schedule': minor
'@objectstack/service-automation': minor
'@objectstack/spec': minor
'@objectstack/lint': minor
'@objectstack/cli': patch
---

feat(triggers): declarative time-relative trigger — daily sweep instead of fragile date-equality (#1874)

Time-relative business rules ("alert 60 days before a contract's `end_date`")
could only be expressed as a `record_change` flow gated on a date-equality
condition like `end_date == daysFromNow(60)`. That predicate is only evaluated
when the record *happens to change*, so it fires only if a record is edited on
exactly the threshold day — i.e. almost never, unattended. The robust
alternative was a hand-written cron + range query that every author
re-implemented (contracts `renewal_alert`, hr `document_expiring_soon`,
procurement `po_overdue`, …).

A flow's start node can now declare a `timeRelative` descriptor instead:

```ts
config: {
  timeRelative: {
    object: 'contracts',
    dateField: 'end_date',
    offsetDays: [60, 30, 7],      // T-minus reminders — fires on each threshold day
    // — or — withinDays: 30      // "expiring soon" range; negative = overdue lookback
    filter: { status: 'active' }, // optional, ANDed with the date window
  },
  schedule: { type: 'cron', expression: '0 8 * * *' }, // optional; defaults to daily 08:00 UTC
}
```

The new `time_relative` trigger (shipped in `@objectstack/trigger-schedule` as
`TimeRelativeTriggerPlugin`) sweeps the object on that schedule and launches the
flow **once per matching record**, with the record on the automation context —
so the start-node `condition` gate and `{record.<field>}` interpolation work
exactly as for a record-change flow. Because the window is evaluated every day,
a threshold is never missed regardless of when the record last changed. The
discovery query runs as a system operation (RLS-bypassing) and is capped
(`maxRecords`, default 1000) so a mis-scoped window can't fan out unboundedly;
per-record failures are isolated so one bad row never aborts the sweep.

The automation engine routes a start node carrying `config.timeRelative` to the
`time_relative` trigger (ahead of the plain `schedule` trigger, whose behavior is
unchanged), and `os validate` gains readiness checks for the new descriptor
(unknown swept object, ambiguous draft status). New authorable spec key:
`TimeRelativeTriggerSchema` (`@objectstack/spec/automation`).
