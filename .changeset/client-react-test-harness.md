---
"@objectstack/client-react": patch
---

test(client-react): give the package a test harness and pin the realtime hooks' behavior (#4682)

`packages/client-react` shipped 8 public hooks with `build` and `typecheck` as
its only scripts and not a single test file. `tsc --noEmit` cannot see any of
what actually breaks in a hook: a dependency array is a value, not a type, so a
missing entry, a missing cleanup, and a callback that never fires all typecheck
perfectly. #4678 was precisely that shape — `useAutoRefresh` ignored predicate
writes, the one case that dirties a list hardest, and no type noticed.

Adds the workspace's first DOM test environment (`jsdom` + `@testing-library/
react`, `environment: 'jsdom'` — every other package runs `node`) and 17 tests
over the realtime hooks, covering the three things the type checker is blind to:

- **Re-subscription on dependency change** — changing `object` opens a
  subscription on the new name and releases the old one; a re-render that
  changes nothing must not churn. Also pins that the hooks key on the primitive
  `options?.recordId` / `options?.packageId` rather than on the options object's
  identity, so an equal-but-new object stays a no-op.
- **Release on unmount** — every subscription hook unsubscribes, including
  `useAutoRefresh`, which holds two.
- **Delivery** — events reach state and callbacks, and `useAutoRefresh`
  refetches on the per-record *and* the bulk stream (the #4678 regression pin).

Each assertion was verified by sabotage: dropping the `object` dep, deleting a
cleanup, and reverting `useAutoRefresh` to the single-stream version each turn
the suite red, and only reverting turns it green again.

The package is picked up by CI's `Test Core` shards automatically — they
partition by package off `turbo ls`, so a `test` script is all that was needed.

No runtime code changed.
