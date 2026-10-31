---
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-detail': patch
'@object-ui/i18n': patch
---

feat(console): a comment author is told, in one sentence, which mentioned users will not be notified

Clause-②: yes (widening)
Metadata-protocol: none

When a record comment @mentions someone the server's mention gate refuses, the server saves the comment with every mention, withholds that person's notification, and answers their ids to the author's own write as `withheldMentions`. The Console said nothing, so the author believed the colleague had been told. Now:

- **One sentence, no reason.** Posting a comment, posting a reply, or saving an edit that adds a mention raises one warning naming the users who will not be notified, by the names the mention picker offered ("Grace Hopper, Linus will not be notified of this comment."). It gives no reason. A write that withheld nobody says nothing. The copy is `detail.mentionsWithheld` in all ten packs.
- **The answer reaches the caller.** `ObjectStackAdapter.create` and `.update` take an optional per-call `onMentionsWithheld(ids)` listener (on `update`, beside `ifMatch`). It is called once, after the write succeeded, only when the answer names at least one id; a throwing listener does not fail the write. Both methods still resolve the record, so no other caller sees a change.
- **Mention chips.** The comment composer draws the users the text mentions as a row of chips under the editor (labelled `detail.mentionedPeople`), resolved the way the write resolves them, and the preview draws each picked `@name` as one chip, multi-word names whole.
