---
'@objectstack/driver-memory': patch
---

refactor(driver-memory): the cube face's own whole-day bound and the in-memory reference matcher are deleted; no answer a caller gets moves (#5930 step 4, #20822)

Clause-②: no

- **`MemoryAnalyticsService` (the cube face).** Its `where` door has run the shared `lowerFilterCondition` (`@objectstack/spec/data`) since #5930 step 3, on every column. A bare-day `$lte` therefore reaches the `lte` row already lowered: as `$lt` the next day, or as `$null: false` on `9999-12-31`. The row's own copy of that rule is deleted, and the `lte` row now compiles the comparison it is handed on both exits. The rows `query()` returns and the SQL `generateSql()` echoes are unchanged. An explicit `dateRange` end still widens a bare day through its own window arm (ADR-0053 D-D1 item 8).
- **The reference matcher (`memory-matcher.ts`, `match()`) is retired** (ruling D6 on #5930). No production code called it and the package never exported it: the published `dist` exports are the same 33 names before and after. `InMemoryDriver` keeps `getValueByPath`, the one helper it imported from that module. The matcher's tests now assert the live query path (`InMemoryDriver.find`), the shared filter shape gate, or the spec predicate the matcher evaluated.
