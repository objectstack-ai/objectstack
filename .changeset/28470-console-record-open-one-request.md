---
'@object-ui/types': patch
'@object-ui/react': patch
'@object-ui/plugin-detail': patch
'@object-ui/app-shell': patch
---

feat(console): a record open is one request — the discussion, the activity, the attachments and the related rows' names come with the page payload (#28470)

Clause-②: yes (widening)
Metadata-protocol: none

After the record page payload answered, a record open still sent the comment thread, the activity feed, the attachment list, the mention list and one `?top=1` name read per object the related rows point at. They are gone from the open:

- The page asks the payload for the discussion and the activity when a block that draws the feed is on screen at open (the 动态 panel of a laid-out page, or a feed block on the tab the page opens on), and for the attachments when the page draws them. The feed, the Attachments panel and the Attachments tab badge draw those parts; a refused part draws the refusal the panel draws today. There is no fallback read: a part the payload carries is never read again on the open.
- Each related list asks the lookups of its rows to resolve, as its own read expands them, so the rows carry their names. The related list's name fallback no longer resolves the parent record's own id, which no column draws.
- The mention list (`sys_user`, 50 rows) is read on the comment composer's first focus, not when the record opens. A reply or an edit whose text holds an `@` before then reads it when written, so its mentions still resolve.

- `@object-ui/types`: `RecordPagePayload` gains `discussion`, `activity` and `attachments`.
- `@object-ui/react`: `DiscussionContextValue.onMentionSuggestionsWanted`.
- `@object-ui/plugin-detail`: `RichTextCommentInput`, `RecordActivityTimeline` and `RecordChatterPanel` take `onMentionSuggestionsWanted`, called on the editor's focus; `record:activity` and `record:chatter` pass the context's hook.
