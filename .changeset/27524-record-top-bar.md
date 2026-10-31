---
'@object-ui/components': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

feat(app-shell): one top bar above the record header on every face — the breadcrumb on the left; the counter with ↓ ↑, ⊟, ⤢ / ⤡ and ✕ on the right, each only where it applies

Clause-②: yes (widening: `@object-ui/components` gains `RecordTopBar`, `RecordTopBarButton`, `useRecordStepKeys` and the types `RecordTopBarProps` and `RecordTopBarStepper`, `NavigationOverlay` gains an optional `toggles` prop and its `stepper` an optional `position` and `scope`; `@object-ui/i18n` gains `detail.recordOfScope`, `detail.relatedFilter`, `detail.relatedChips`, `detail.relatedChipAll`, `detail.relatedChipMine`, `detail.relatedChipOverdue`, `detail.relatedExport` and `detail.relatedRows` in all ten locales; no export retires and no accept set moves)
Metadata-protocol: none

The record page v4 draws one 40 px top bar above the record header, on every face: the full page, the split pane, the overlay drawer, the maximized pane and a phone. The bar holds the frame controls. The record header's action row keeps the business actions only.

- **Left: the breadcrumb.** At the root it reads 「对象 › 记录名」 (for example 「Leads › Mira Costa」). The object returns to the list: in a pane it closes the pane, and on a page it goes to the list the page was opened from, or to the object's list. One level down in a pane, the bar keeps 「← 路径」 as before. A page opened under a `?from=` trail shows ← and the same path, and each ancestor links to its page.
- **Right, in a fixed order.** First the counter 「3 / 21」 and ↓ ↑. Its tooltip names the list's view. Then ⊟, then ⤢ / ⤡, then ✕. Each control is drawn only where it applies:
  - In a pane, the counter and ↓ ↑ show whenever the pane has a list context. ✕ shows on the pane faces only, and it closes the whole path.
  - On a page, the counter and ↓ ↑ show only for a page a list opened: the row's ↗, or a row click or record link on a list whose rows open as pages. ↓ ↑ and `j` / `k` step through that list's rows: a step replaces the page with the sibling's page. The arrow keys still scroll the page.
  - ⤡ 「收为抽屉」 (Collapse to drawer) shows only for a page the row's ↗ opened. It returns to the list with the record you stepped to open in the pane.
  - A page opened directly shows only ⊟.
  - While a pane is open over a page, the pane owns `j` / `k`.
- **⊟ moves into the bar.** The right-column switch (「右栏」, ⌘⇧,) leaves the record header's action row. It is drawn in the top bar only where the face's tier has a right column. In a pane, the record puts it into the pane's own bar. A host's plain overlay without the console's pane keeps it at the end of the header's action row.
- **The crumb row goes.** The row above the record header that held 「‹ origin」 and 「Collapse to drawer」 is removed. Both now live in the top bar.
- **The enlarged related list draws a toolbar.** When a related list is the active tab, it draws a toolbar over the table instead of the related list's card header and foot. The toolbar holds a filter input, the chips 全部 N / 我的 / 逾期, the child object's toolbar actions, 新建 and 导出, and a 「N 条 · 第 x / y 页」 line sits above the table. 我的 is drawn where the child object has an `owner_id` column. 逾期 is drawn where the child object declares a deadline (`dueLike: true` on a `date` or `datetime` field) with no `settledWhen`, because no query can ask which deadlines are settled. 导出 downloads a CSV through the server with the same parent, filter, chip, filter text and order the table shows.
- **动态 count on a deep link.** A link that opens the record on another tab, or a page with the right column switched off, still shows the 动态 tab's count. The count comes from the feed the page already holds; it starts no read of its own.
