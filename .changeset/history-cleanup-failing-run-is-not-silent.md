---
'@objectstack/metadata': patch
---

fix(metadata): a `HistoryCleanupManager` run that loses deletes now says so, at both of `start()`'s triggers

A failing history cleanup was completely silent. Three things composed: every inner `catch` on the delete path is a bare `catch {`, so the error object is discarded; the only `console.error` in `runCleanup()` sits in its OUTER catch, which those inner catches prevent execution from reaching; and `start()` invoked the run as `void this.runCleanup()`, throwing away the `{ deleted, errors }` the run returns — at BOTH call sites, the immediate run and every interval tick. A driver whose deletes failed on every scheduled run therefore produced zero output and no reachable error count, while the history table grew past its retention policy with nothing to find.

The repair reads the envelope instead of replacing it. `runCleanup()`'s contract, its inner catches and its counting are unchanged: reporting a failure to the CALLER is the third answer AGENTS.md → "Degradation log levels" allows a durability seam, and that same section names a log per failed write as the mirror-image failure. What was missing was a reader — `start()` is where the chain ends, since it returns `void` and an interval tick has no caller at all. Both call sites now go through one shared pass that reads the returned counts and, when a run lost deletes, prints one `error` line naming the consequence (rows past the retention policy are still in the table, nothing retries them, and the system keeps reporting healthy) and where to look. A run that loses nothing stays quiet, and a direct caller of `runCleanup()` sees exactly the same `{ deleted, errors }` as before.
