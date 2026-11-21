---
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): on a wide full record page the details are pinned in a left column and the other tabs sit beside them; the right summary rail is retired

Clause-②: yes (widening)
Metadata-protocol: none

The synthesized record page (objectstack#35890, ruling on the card 7064066204):

- **Pinned details.** A full page whose content fits a 320 px details column, a 24 px gap and 400 px of tabs pins the record's details in a left column and draws the other tabs (related lists, Attachments, Approvals, 动态) beside them, opening on the first. The column is 400 px wide and narrows toward 320 px on a tight page; its edge is a separator the reader drags, or moves with ←/→ (Home/End for the ends). The dragged width is kept per object in the console's workspace preference store (`record.columns.details-width`, this browser). Each column scrolls on its own. A page with no other tab draws the details across the page with no tab row; a page whose details hold a related table among the fields (objectstack#35889) is not pinned and keeps its one-column tab row. Narrowing out of the pinned layout keeps the tab that was shown, writing it to the address with `replace`.
- **The right rail is retired** at every width, with its ⊟ switch and `⌘⇧,` shortcut and the `record.columns.related` preference (an old stored choice is no longer read). Its cards (approval, attachments, recent activity, other related) are the tabs they summarised.
- **「详情」.** The first tab is named Details (详情) in every locale.
- **「审批中 · 当前步骤」.** For everyone but the approver, the header's in-approval tag names the step the request waits at, when it has one.
- The drawer, the split pane and a phone are unchanged apart from the rail; authored pages are untouched.

`RecordPageColumns` gains the optional `fullPage`, `detailsWidth`, `onDetailsWidthChange` and `onShownTabChange` props, and `onEnlargeRelated` an optional `{ replace }`; `rightColumn` and `rail` are kept as deprecated props that do nothing. `@object-ui/plugin-detail` exports `RECORD_PAGE_DETAILS_WIDTH`, `RECORD_PAGE_PIN_MIN_WIDTH` and `recordPagePinsDetails`.
