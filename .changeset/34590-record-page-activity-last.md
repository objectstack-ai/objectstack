---
'@object-ui/plugin-detail': patch
---

feat(plugin-detail): the default record page shows Activity last — after the related panels, attachments and approvals

Clause-②: no
Metadata-protocol: none

On a record page nobody wrote by hand, the Activity stream used to come first in the right column, right after the details on a narrow screen, and second in the tab row. Members open the related records far more often than the stream, so the stream now comes last everywhere the default page draws it:

- wide and two-column layouts: the right column reads related panels, then attachments, then approvals, then Activity;
- one-column layout (a phone, the split pane): details, related panels, attachments, approvals, then Activity at the very bottom;
- the tab row: Overview, the related panels, then Activity. While the panels' first counts are still loading, the Activity tab waits off the row with them, so no tab moves when they arrive;
- the synthesized `page:tabs` strip (`buildDefaultTabs`, `buildDefaultPageSchema`, and what Studio seeds a new record page with): Details, Related, Approvals, then the Activity stream.

A hand-written record page keeps the order its author wrote. Nothing an author writes changes: every tab keeps its `value` (`details`, `related`, `approvals`, `timeline`), so `?tab=` links still open the same tab. Code that splices a custom tab into `buildDefaultTabs(...).items` by position should find its place by `value`, since the Activity stream's index moved from second to last.
