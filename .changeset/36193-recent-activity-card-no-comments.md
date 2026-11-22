---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): a slotted page's record:chatter on the 动态 tab lists the system history alone while the comment panel holds the comments

Clause-②: no
Metadata-protocol: none

- A page whose `discussion` slot holds `record:chatter` or `record:discussion` draws that block on the record page's 动态 tab. While the comment panel is offered beside the record (objectstack#36075), the block now draws the system entries alone, as the platform's own 动态 stream does there: no comment and no reply, no comment box, no Comments-only filter, a count without the comments, the 动态 heading instead of 「讨论」, and the activity empty line instead of 「暂无评论」. A refused or failed comment read is the panel's to report, not this block's.
- Not changed: the platform's own 动态 stream, the 动态 tab's label, a page an author composed whole, the drawer, and the phone while it has no comment surface.
