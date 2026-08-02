---
"@objectstack/client-react": minor
---

feat(client-react): bulk-write hooks, and `useAutoRefresh` now refreshes on predicate writes (#4678)

#4639 gave predicate writes (`multi: true` update/delete) their own event
contract — `data.records.updated` / `data.records.deleted`, carrying a
`matched` count and no record — and `@objectstack/client` exposes them via
`subscribeBulkData`. The React hooks never caught up: all three realtime data
hooks delegated to `subscribeData`, so React consumers could not see bulk
writes at all.

The sharpest edge was **`useAutoRefresh`**. Its whole job is "refetch when the
data changes", and a predicate write is the case that dirties a list hardest —
one statement can change or delete every row on screen. It sat still for those
while refetching dutifully for a single-row edit.

- **New `useBulkDataSubscription(object)`** returning the latest
  `BulkDataEvent`, and **`useBulkDataSubscriptionCallback(object, cb)`** for
  the refetch/side-effect case.
- **`useAutoRefresh` now watches both streams.** Safe here in a way it is not
  for `useDataSubscription`: this hook's output is a refetch signal, not an
  event body, so the shape difference that keeps the two contracts apart never
  reaches the caller. When `options.recordId` narrows it to one record it still
  refetches on a bulk event — a count cannot say whether that record was in the
  match set, and a redundant query beats showing a row a predicate write
  already changed.
- **`useDataSubscription` / `useDataSubscriptionCallback` are unchanged** and
  still per-record only. Their callbacks are typed `(event: DataEvent) => void`;
  letting a `BulkDataEvent` through would hand them an object whose `recordId`
  and record body are `undefined` — the defect #4626 removed.
