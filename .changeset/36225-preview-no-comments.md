---
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
---

feat(record-page): the side preview drops the comments icon and the comment panel; a record's comments are on its full page

Clause-②: no
Metadata-protocol: none

A record opened in the side preview (the drawer or pane a list opens, and the drawer a record page opens over itself) no longer shows the comments icon in its header, and no comment panel can be opened anywhere in it. Its 动态 tab keeps the system entries alone, with no comment and no comment box, so the preview shows no comments at all. To read or write a comment, open the record as a full page from the preview header; the full page's comments icon, panel and comment box are unchanged, and so is the phone's comment page.

This replaces the lines of the objectstack#36075 record-comment-panel entry that put the icon and the panel in the record drawer: there is no drawer placement any more (no cover of the drawer body under 760 px, no split above it), and the browser keeps one open-or-closed choice, the record page's. No props, exports or metadata change.

The `@object-ui/plugin-detail` README and the docs of `RecordCommentsInPanelContext` now describe the preview case; no code changes there.
