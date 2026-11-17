---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console-ai): a message sent while an image or PDF is still uploading no longer reaches the agent before the turn that carries it

Clause-②: no
Metadata-protocol: none

In the console's AI chat, a turn with an image or PDF is sent only once its upload settles (seconds for a large photo), while a turn without an attachment is sent at once. So a second message sent during the upload used to reach the agent first, and the agent answered it without the file.

- Turns now reach the agent in the order the user sent them: a turn sent while an earlier turn's attachments are still being read waits behind that turn.
- While a turn's attachments are being read, the composer reads as busy, as it does during a running reply: a message typed then queues above the composer and sends after that turn.
- An upload that fails releases the busy state, and the turn still sends, naming the file as not read. A turn with no attachment is sent at once, as before.
