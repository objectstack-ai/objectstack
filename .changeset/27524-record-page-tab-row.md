---
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

feat(plugin-detail)!: a tab row closes the record header — 概览, 动态, then each related panel with its count, as many as the row's width fits; an open panel face is the active tab

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @object-ui/plugin-detail#ArrangedRelatedTab) the retired operand is a component in a published ui package's entry that only the console's own record view imported, for the tabbed tier the record page no longer has; no packages/spec schema, no registered node type, no ADR-0087 conversion surface and no stored shape names it, so there is nothing for `objectstack migrate meta` to rewrite -->

The synthesized record page (record page v4) gets a persistent tab row at the bottom edge of its record header, on every face: the full page, the split pane, the overlay drawer, the maximized pane and a phone.

- **The tabs.** 「概览」 (Overview) first, then 「动态」 (Activity), then one tab per related panel in the reader's arrangement (`record.related.arrangement`), each with its count. 「动态」 shows the stream's size and a related tab its list's count. The counts come from the same request set the right column's panels read, so no relationship is counted twice.
- **Width.** The row shows as many tabs as fit its own width, measured on every resize (the window, the sidebar collapsing, a pane dragged wider). The rest fold into 「+N ▾」, which lists them with their counts, and the hidden panels' tabs come at its end. 「概览」 and at least one more tab are always on the row. So is the active tab: when it would fold, it takes the row's last slot instead.
- **The open face is the active tab.** Choosing a tab, a panel's header or 「查看全部 N 条」 draws that panel's whole face below the tab row, at the page's full width: the related list with every column, paging, sort and inline edit, or the 动态 stream with its chips. The top of the page and the record header stay as they are. The URL keeps `?related=<object>.<field>` and `?related=timeline`. 「概览」 or Esc returns. The face no longer draws a ‹ back line or a title of its own, because the tab names it. Moving from one tab to another replaces the history entry, so one Back, Esc or 「概览」 always returns to the page. Inside the pane the face fills the pane body, and maximizing widens it in place.
- A body table that is open in place (its ⤢ in the details) takes a tab of its own while it is open.
- **Reads.** The page now counts every related panel, including the hidden ones and those behind a closed ⊟, because their tabs show the counts.
- A synthesized page whose tab strip cannot be laid out is drawn as written. Its 关联 tab no longer reorders its lists to the reader's arrangement, which the right column and the tab row now carry.

**BREAKING** (`@object-ui/plugin-detail`, TypeScript only). The only importer was the console's own record view. `ArrangedRelatedTab` leaves the package entry. It laid the reader's arrangement over the 关联 tab of the tabbed tier, which the record page no longer has. FROM `ArrangedRelatedTab` TO no wrapper: draw the page with `RecordPageColumns`, whose right column and tab row read the arrangement, or draw an unlaid page as written. A caller still naming it gets a compile error that names it.
