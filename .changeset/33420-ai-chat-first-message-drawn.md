---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): the first message of a new AI chat conversation shows at once, and a failed conversation create gives the text back

Clause-②: no
Metadata-protocol: none

- **Drawn at once.** On a new conversation the first send is what creates the conversation, and the message waits in the browser until `POST /conversations` answers. The thread used to stay empty for that whole wait. The message now shows straight away as the user's bubble, with the assistant's thinking dots under it, and is drawn exactly once when the conversation opens and the message goes out. A second message sent during the wait joins the first one (as before) and shows with it. This holds on the full-page AI chat, in the console's chat dock and in the Studio copilot.
- **A failed create gives the text back.** When `POST /conversations` fails, the waiting message is taken off the thread, its text goes back in the message box and the "Couldn't send your message" notice shows, the same way a chat send that never left the browser is handled. The message is no longer kept out of sight to be sent with the next one. Sending again retries the create.
