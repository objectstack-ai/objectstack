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
- **The right rail is retired** at every width, with its ⊟ switch and `⌘⇧,` shortcut and the `record.columns.related` preference (an old stored choice is no longer read). Its cards (approval, attachments, recent activity, other related) are the tabs they summarised. A list the reader hid still opens, from its item in 「更多」 or from an address that names it (`?related=`).
- **「详情」.** The first tab is named Details (详情) in every locale.
- **「审批中 · 当前步骤」.** For everyone but the approver, the header's in-approval tag names the step the request waits at, when it has one.
- **Drawer, split pane and phone** keep their one-column tab row and never pin. What reaches them: the rail is gone there too, and the first tab reads 「详情」 / Details. Authored pages are untouched.

`RecordPageColumns` gains the optional `fullPage`, `detailsWidth`, `onDetailsWidthChange` and `onShownTabChange` props, and `onEnlargeRelated` an optional `{ replace }`; `rightColumn` and `rail` are kept as deprecated props that do nothing. `@object-ui/plugin-detail` exports `RECORD_PAGE_DETAILS_WIDTH`, `RECORD_PAGE_PIN_MIN_WIDTH` and `recordPagePinsDetails`; `recordPageTierHasRightColumn` stays exported, answering as before, and is now `@deprecated` (no tier draws a right rail).

`@object-ui/i18n` widens: two new keys in every pack, `detail.approvalPendingStep` (`In approval · {{step}}`) and `detail.detailsColumnResize` (the separator's name), and `detail.recordTabOverview` changes its text from 概览 / Overview to 详情 / Details. Every key the rail read (`detail.relatedColumn`, `detail.relatedHiddenCount` and its plural forms, `detail.relatedShowHidden`, the six `detail.summary*` keys and `shortcuts.toggleRelated`) stay in every pack, unread, so a host that reads them keeps its text; retiring them is a separate change.
