# Automation — long flow examples (moved verbatim from SKILL.md)

### Flow Example — Auto-Escalate Overdue Cases

> **Nodes connect via `edges`, not a `next` property.** The engine traverses
> `flow.edges` (`{ source, target }`); a bare `next:` on a node is refused.
> `update_record` selects rows with **`filter`** — an ObjectQL `where` **map**
> of `field → value` / `field → { $operator: value }`, NOT the UI view-filter
> `[{ field, operator, value }]` triples — and writes with **`fields`**
> (a single call updates *every* matching row — no per-row loop needed).
> `label` is **required** on the flow and on every node, and every path through
> the graph must reach an `end` node.

<!-- os:check -->
```typescript
import { defineFlow } from '@objectstack/spec';

export const EscalateOverdueCasesFlow = defineFlow({
  name: 'escalate_overdue_cases',
  label: 'Escalate Overdue Cases',
  type: 'schedule',
  status: 'active',
  runAs: 'system',   // a scheduled run has no trigger user — elevate explicitly
  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'Daily at 09:00',
      // The cadence lives HERE, on the start node's config — FlowSchema has NO
      // top-level `schedule` key (one there is a named parse error, not a silent
      // strip). A bare cron string also works: schedule: '0 9 * * *'. Do NOT use
      // the cron`…` tagged template — its envelope is not a recognized shape.
      config: { schedule: { type: 'cron', expression: '0 9 * * *' } },
    },
    {
      id: 'escalate_overdue',
      type: 'update_record',
      label: 'Escalate Overdue Cases',
      config: {
        objectName: 'support_case',
        // which rows to update — `filter` is a `where` map, not filter triples
        filter: {
          status: { $in: ['new', 'open'] },
          due_date: { $lt: '{TODAY()}' },   // template token → today's date at run time
        },
        // what to write — `fields`, not `values`
        fields: { status: 'escalated' },
      },
    },
    {
      id: 'notify_manager',
      type: 'http',
      label: 'Notify Manager',
      config: {
        url: 'https://hooks.slack.com/services/...',
        method: 'POST',
        body: { text: 'Escalated overdue support cases.' },
        timeoutMs: 10000,   // unset = NO timeout at all — always set one
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start',            target: 'escalate_overdue' },
    { id: 'e2', source: 'escalate_overdue', target: 'notify_manager' },
    { id: 'e3', source: 'notify_manager',   target: 'end' },
  ],
});
```

### Time-relative triggers — scheduled per-record date sweep

**Don't** express "act N days before/after a date" (renewal reminders, "expiring
soon", overdue sweeps) as a `record_change` flow gated on date-equality
(`end_date == daysFromNow(60)`) — that predicate is only evaluated when the
record *happens to change*, so unattended it almost never fires. Use a
**declarative time-relative trigger**: a `schedule`-type flow whose `start` node
carries a **`timeRelative`** descriptor is swept on a schedule (daily by default)
and launched **once per record** whose date field falls in the window. The record
is on the context, so the start `condition` and `{record.*}` interpolation work
exactly as for a record-change flow — and because the window is evaluated every
day, a threshold is never missed.

```typescript
{
  name: 'renewal_alert',
  label: 'Renewal Alert',
  type: 'schedule',
  runAs: 'system',              // a sweep has no trigger user — elevate explicitly
  nodes: [
    {
      id: 'start', type: 'start', label: 'Daily Sweep',
      config: {
        timeRelative: {
          object: 'contracts',
          dateField: 'end_date',
          offsetDays: [60, 30, 7],   // fire exactly at T-60 / T-30 / T-7
          // — or — withinDays: 30    // "expiring within 30 days" (negative = overdue lookback)
          filter: { status: 'active' },  // optional, ANDed with the date window
          // maxRecords: 1000            // optional per-sweep cap (default 1000)
        },
        // Optional sweep cadence; omit for daily 08:00 UTC. Plain shape only:
        // schedule: { type: 'cron', expression: '0 8 * * *' }
      },
    },
    // …downstream nodes (notify, update_record, …)
  ],
  edges: [ /* start → downstream */ ],
}
```

**Date EQUALITY never matches**, so a hand-rolled sweep filters windows, not
days: a `date` field carries a time component, so `field == daysFromNow(N)` (or
`{ $in: [...] }`) compares two differently-timed timestamps and silently returns
nothing (build warns `flow-date-equality-filter`). Tier each threshold as a
one-day **window** (`$gte`/`$lt`):

```ts
filter: { status: 'active', $or: [
  { end_date: { $gte: '{TODAY() + 7}',  $lt: '{TODAY() + 8}'  } },
  { end_date: { $gte: '{TODAY() + 30}', $lt: '{TODAY() + 31}' } },
  { end_date: { $gte: '{TODAY() + 60}', $lt: '{TODAY() + 61}' } },
] }
```

Abutting windows tile the timeline, so each record matches exactly one tier —
fires once, idempotent, no guard field. Use `{TODAY() + N}` template tokens in
CRUD-node filter values; a `cel\`…\`` envelope is not evaluated there and would be
compared as a literal object. For "days remaining" in a message, use
`daysBetween(today(), record.end_date)`.

Exactly one of `offsetDays` (discrete T-minus days) or `withinDays` (a range;
negative = overdue) is required. Ships in `@objectstack/trigger-schedule` —
needs `requires: ['automation', 'triggers']` **plus `'job'`** (the sweep cadence
runs on the job service). Full descriptor schema:
`node_modules/@objectstack/spec/src/automation/time-relative-trigger.zod.ts`.
