---
---

docs(hook-bodies): the write-set section said the write side had no static checking, which #4305/#4344 made false (#4351) — rewritten as an accurate coverage description (three literal patterns, advisory `hook-body-write-unknown-field` / `action-body-write-unknown-field`, and the shapes the parser must skip, so a missing warning is not read as proof of correctness), the "accepted gap with no planned closure" conclusion retracted (#3700 stays accurate history; the gap was closed from the other end, by parsing the write set), the runtime paragraph corrected against measured behaviour, and the three now-stale cross-links in `hooks.mdx` updated to the renamed anchor. Releases nothing.
