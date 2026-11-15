---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): a message sent while a linked AI chat conversation loads is given back when the load fails

Clause-②: no
Metadata-protocol: none

- **No more endless thinking dots.** In the AI chat (the full-page chat, the console's chat dock and the Studio copilot), a message sent while the conversation was still loading waited for it. When loading then failed (a server error or no network), the message stayed on screen with the thinking dots forever: nothing was sent, nothing was shown and the message box was empty. Now the message is taken back into the box with the "Couldn't send your message" notice, two messages sent during the wait included (first part first), and nothing is sent. Sending again loads the conversation again and sends the message once into it.
- **Unchanged:** a load that answers sends the waiting message once into the conversation, and a conversation that no longer exists (404) still starts a new one for it.
