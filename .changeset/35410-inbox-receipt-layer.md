---
'@object-ui/app-shell': patch
---

fix(app-shell): the inbox badge's read-state no longer waits for the inbox messages to load

Clause-②: no
Metadata-protocol: none

The bell badge and Home's action centre read the signed-in user's newest 20 inbox messages and the receipts that say which of them are read. The receipt read used to start only after the message read answered, so on every console page load it was the last request to go out. It now reads the newest 20 inbox receipts at the same time as the newest 20 messages, and asks by id only for a listed message whose receipt that read did not carry, so the read-state, the unread count and the badge stay exactly as they were. An inbox with no messages still sends no receipt read on its later polls.
