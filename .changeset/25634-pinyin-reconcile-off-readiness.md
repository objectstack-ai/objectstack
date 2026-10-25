---
'@objectstack/plugin-pinyin-search': patch
---

fix(plugin-pinyin-search): the boot companion pass no longer holds readiness, and an unchanged restart reads no rows

Clause-②: yes
Metadata-protocol: none

Before this change, `PinyinSearchPlugin` awaited a full walk of every row of every object that carries the `__search` companion inside `kernel:bootstrapped`. The kernel awaits that hook before `kernel:listening`, so the HTTP server opened only after the largest such table had been read. Every restart paid the same walk again, even when nothing had changed. In production, 6.7 M `sys_inbox_message` rows took about 4 min 50 s.

Now:

- The pass starts at `kernel:bootstrapped` and runs after readiness. Writes made through ObjectQL meanwhile are stamped by the companion hooks, as before. A failure is logged at `warn`. Plugin `destroy()` stops the pass between pages.
- When a walk of an object completes, the pass records it in one `sys_migration` receipt row (id `pinyin-search-companion`, `blocking: 0`, `verified_at: null`). A later boot reads only the rows written since that walk that still have no companion. On an unchanged table that is one query that returns no rows. A changed display field, or a kernel without `sys_migration`, falls back to the full walk.
- `rebuildSearchCompanion()` (`force: true`) still walks every row. Use it after an import that bypasses hooks and back-dates `updated_at`.
- `CompanionBackfillResult` gains `pages`, `CompanionBackfillOptions` gains `signal`, and `PinyinSearchPlugin` gains `whenReconciled()`, which resolves when the boot pass ends.

What to do: nothing. The first boot after upgrading walks each companion-bearing object once more, after readiness. Later boots read only what changed.
