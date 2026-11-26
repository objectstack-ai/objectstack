---
'@object-ui/app-shell': patch
---

fix(console): on a phone, a page the AI assistant opens closes the assistant sheet so the page shows

Clause-②: no
Metadata-protocol: none

On a phone the assistant is a bottom sheet over the page. Clicking a citation chip in an answer opened the cited record section underneath, but the sheet stayed open over it, so the marked heading was hidden and the click looked like it did nothing. Now a navigation the assistant makes on a phone (a citation chip, a record or list link, opening a form) closes the sheet, including a second click on the same chip. The conversation is kept: reopening the assistant shows the same thread. On a desktop the assistant is a panel beside the page and stays open, as before.
