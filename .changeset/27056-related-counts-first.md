---
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

perf(plugin-detail,app-shell): the record page's related column loads counts first, then rows only for the cards in view, and never blocks the details

Clause-②: no
Metadata-protocol: none

Opening a record with many related lists used to read every list's rows as the page opened. The related column now loads in three steps, and the details column never waits for it:

- **Counts first.** When the page opens, every card in the related column is counted in one request set, sent beside the record read. Each count reads the total and one row's id, nothing more. Until the whole set has answered, each card shows a placeholder. Then each card's header draws from its count. A card counted at 0 is its title row alone and reads no rows. The counts share the store the tab strip's badges read, so a write to a child counts it again.
- **Rows on demand.** A card reads at most three rows, in its inherited sort, and asks only for the fields it draws: the record's name field and one status or date field. That field comes from the relationship's `relatedListColumns` when declared, else the object's status field, else its first date field. A card reads its rows only once it comes into view (`IntersectionObserver`; cards just below the fold count as in view). The folded 「动态」 card (the timeline switched off) is closed until the reader opens it, and its feed reads nothing until then.
- **Details first.** The details column draws from the record read alone. The related column's placeholders hold their place until the counts land.
- **Drawer prefetch.** In the record drawer, the record that `↑` / `↓` would show next has its related counts read once the current record has loaded, so the next record's badges draw from the store.

Additive API (`@object-ui/plugin-detail`): `prefetchRelatedCounts`, `relatedCountTargetsIn`, `relatedCountTargetOf` and their types are exported. `RecordPageColumns` takes an optional `relatedFieldsOf`, the child objects' field definitions the host already holds, so the counts read no child schema first.
