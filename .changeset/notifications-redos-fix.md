---
"@objectstack/runtime": patch
---

fix(runtime): replace the polynomial-redos trailing-slash regex in the notifications domain with split+filter (CodeQL high, surfaced by #3507)

The legacy `path.replace(/\/+$/, '')` in the notifications handler had
carried a polynomial-backtracking regex over request-controlled input since
ADR-0030; the domain extraction (#3507) made the line "changed code" and
CodeQL flagged it. Same split+filter treatment the security domain already
uses for the identical pattern. Redundant slashes in the sub-path now
collapse (`//read//` → `read`), matching the security domain's semantics.
