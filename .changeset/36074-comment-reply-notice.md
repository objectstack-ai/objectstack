---
'@objectstack/plugin-audit': patch
---

feat(plugin-audit): a reply in a comment thread notifies the thread's starter and the people who replied in it before

Clause-②: yes (widening) — `@objectstack/plugin-audit` emits a new notification topic, `collab.reply` (inbox and e-mail), and loads three new `messages.*` keys (`repliedToYourComment`, `repliedInYourThread`, `repliedAnonymous`) in all eleven locales into the host i18n service; nothing removed or refused
Metadata-protocol: none

Before, only an `@mention` notified anyone about a comment. Someone who started a thread, or replied in it, heard nothing when another person answered.

- **Who is notified.** When a comment is written as a reply (`parent_id` set), the writer finds the thread: it follows `parent_id` up to the top-level comment (whose author is the starter), then reads every distinct author of a reply to that comment in one grouped query (`author_id … WHERE parent_id = ? GROUP BY author_id`). Each of them is notified, except the reply's author and anyone this reply mentions (they get the mention notification, not two).
- **Who is not.** Each participant passes the same recipient gate as a mention: they are notified only when they can read the record and the reply itself, judged with their own permissions. A starter who has since lost access to the record gets nothing. Editing a reply, or writing a top-level comment, notifies no participant.
- **What arrives.** A new topic, `collab.reply`, through the same `messaging.emit` ingress as `collab.mention`: an inbox notice per reply and person, and an e-mail with the comment preview and a link that opens the record. The title says who replied, in the recipient's language: "Bob replied to your comment" for the starter, "Bob replied in a comment thread you are in" for the others. The e-mail templates are the mention e-mail's, registered under `collab.reply` in every catalog locale.
- **E-mail rate.** At most one reply e-mail per person per 10-minute window, the mention e-mail's window under its own key. In one window a person can therefore get one mention e-mail and one reply e-mail. Inbox notices are not limited.
- **Preferences.** Nothing new to set. A `sys_notification_preference` row `(collab.reply, email, enabled: false)`, or `(*, email)`, mutes the reply e-mail and keeps the inbox notice, as for any topic.

Mention notifications are unchanged.
