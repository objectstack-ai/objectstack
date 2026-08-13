---
"@objectstack/service-automation": patch
---

fix(service-automation): a durable PAUSED run is visible to `listRuns` and run-detail after a cold restart (#8050)

After a process restart, a run parked at an `approval` / `screen` / `wait` node
disappeared from the automation API while remaining fully durable:

| read | before | after |
| :--- | :--- | :--- |
| `GET /automation/:name/runs` | 200, **zero rows** | the parked run |
| `GET /automation/:name/runs?status=paused` | 200, **zero rows** | the parked run |
| `GET /automation/:name/runs/:runId` | **404** `RESOURCE_NOT_FOUND` | 200, `status: 'paused'` |

`sys_automation_run` holds two disjoint row families — terminal history rows
(`run_`-prefixed, written on completion) and live suspension rows (keyed by the
raw run id, status `paused`). `AutomationEngine.listRuns` merged the in-memory
ring buffer with the first family only, and `getRun` fell back to the first
family only. Before a restart the gap is invisible because a paused run is still
in the ring; after one, the ring is empty and the suspension rows had no reader.

The sharp edge was `?status=paused`. #7359 had just made that a real filter, and
with no post-restart producer of a `paused` entry it could never match a row —
so the one query an operator reaches for when asking "what is in flight?" was
structurally guaranteed to answer "nothing pending".

This is a read-path change only. Nothing about persistence moves: suspension
rows keep their own id space, lifecycle and retention exemption, and are **not**
reshaped into history rows. Durability was never the defect — a parked run
already served `…/runs/:runId/screen` and resumed cleanly across a restart, and
still does.

Merge precedence is now stated explicitly: durable paused → durable history →
in-memory ring, weakest first. A paused row is the only source that can be stale
(the delete on completion is best-effort), so a terminal row or ring entry for
the same run id is later evidence and wins — a finished run is never reported as
still waiting. The paused read is best-effort like the history read beside it: a
store outage degrades the listing and logs the shortfall rather than throwing.
