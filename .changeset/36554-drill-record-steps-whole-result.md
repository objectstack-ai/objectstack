---
'@object-ui/plugin-dashboard': patch
'@object-ui/plugin-list': patch
---

fix(plugin-dashboard): a record opened from a drill counts and steps through the drill's whole result

Clause-②: yes (widening) — one additive member, `ListViewProps.onFindParamsChange` (`@object-ui/plugin-list`); nothing is removed or renamed
Metadata-protocol: none

A record opened from a dashboard or report drill showed 「1 of N」 and stepped ↑ ↓ only over the rows the drill's list had drawn on its page, so a drill that matched 40 records and drew 20 let the reader walk 20. The `list-view` page block handed its own `onTotalChange` (the tab badge's count) to the list after the host's, so the drill never heard the count; it now hands the count to both. The list now also reports the query behind the rows it draws (`onFindParamsChange`, a host prop answered where `onRowsChange` answers with rows), and the drill re-issues that query for record ids alone, with the same filter, sort and search, when the count exceeds the rows drawn or the rows drawn are a later page. The record page is handed every record the drill matched, in the drill list's order, up to 1,000, and the count it matched, so its counter says where the record sits in the whole drill and ↑ ↓ walk all of it. A read that fails, a record past the first 1,000, or a result that changed under the list keeps the rows drawn as the step set, as before.
