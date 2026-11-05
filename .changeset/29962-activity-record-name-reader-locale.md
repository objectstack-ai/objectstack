---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the record page's activity feed names the record as the reader reads it, as the record's heading does, when the object is named by a formula

Clause-②: no
Metadata-protocol: none

An activity summary quotes the record's name as its writer read it: `sys_activity.record_label`, and the same text inside `summary`, are stored when the write happens. The server composes the rest of the summary in the reader's language on read, but not the name. For an object whose name field is a formula over `label(record.FIELD)`, that name is in the writer's language, so an en-US reader of a review a zh-CN user created read `Created Review "法务 · Legal Counsel 1"` while the heading above it read `Legal · Legal Counsel 1`.

Each activity row of the page's own record now names the record by the value of the object's name field on the record the page read, which is the heading's name. The change is made where the feed is drawn (`RecordActivityTimeline`), so the activity panel, the 动态 stream and the 动态 panel all read it. Only the name the summary quotes (`"…"`, or `「…」` in Japanese) is replaced.

What stays as stored:

- an object whose name field is a stored field (text and the like): the name a row stored is the name the record had then, and a rename does not rewrite older rows;
- a row about another record, a row that carries no `record_label`, and a summary that does not quote the stored name;
- a page with no record around the feed, or whose record has no name to show.
