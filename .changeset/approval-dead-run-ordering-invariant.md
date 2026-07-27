---
---

test(approvals): pin the ordering invariant the dead-run sweep rests on (#3456
follow-up) — releases nothing.

Tests plus one comment reference; no runtime behaviour changes, so no package
needs a version bump. The new coverage asserts that every in-band approval
transition moves its request out of `pending` before it hands the run back —
the unenforced premise `releaseDeadRunRequests` relies on to tell an orphaned
request from a live one.
