---
"@objectstack/client-react": patch
---

fix(client-react): stop five hooks from looping on dependency identity (#4693, #4694)

Five hooks keyed a `useCallback`/`useEffect` on values the caller supplies
inline — `where` / `fields` / `orderBy` objects, `onSuccess` / `onError`
handlers, and the `fetcher` `useMetadata` takes as a required positional
argument. Inline means a fresh identity on every render, so the effect re-ran on
every render; because the fetch hooks call `setState`, that render caused
another. The result was an unbounded request loop under the hooks' own
documented usage.

Requests issued in 250ms by a single mounted component, measured before and
after:

| hook                              | before | after |
|-----------------------------------|-------:|------:|
| `useQuery` (inline `where`)       |   4691 |     1 |
| `useInfiniteQuery` (inline `where`) | 6611 |     1 |
| `useObject` (no options at all)   |   4306 |     1 |
| `useView` (inline `onSuccess`)    |   8197 |     1 |
| `useMetadata` (inline `fetcher`)  |   7654 |     1 |

`useObject` and `useMetadata` needed no particular usage to loop: the former
depended on its own `data` and `etag` state while writing both, and the latter
takes its fetcher positionally, so there is no non-inline way to call it.
`useMutation` was never affected — no effect drives it.

The same root cause churned the realtime subscriptions (#4694):
`useAutoRefresh` with an unmemoized `refetch` — which is what `useQuery`
returned on every render — resubscribed on both streams every render, losing any
event delivered in the unsubscribe/resubscribe gap.

Two internal primitives fix both halves: `stableKey` derives a dependency from a
structural value (sorted keys, array order preserved) so a rebuilt-but-equal
object is a no-op, and `useEventCallback` gives a handler a fixed identity while
always invoking its latest version. Neither is exported.

A changed *value* still refetches, and every stabilized handler is asserted to
run its newest version rather than the one captured when the effect first ran —
the ref indirection would otherwise trade a loop for a stale closure. 13 tests
cover this, each verified by reverting the fix it guards.
