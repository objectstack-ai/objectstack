---
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(console): text typed into the AI chat box is no longer lost when the chat learns its conversation

Clause-②: no
Metadata-protocol: none

- **A draft survives the conversation loading or being created.** In the AI chat (the full-page chat, the console's chat dock and the Studio copilot), text typed into the message box but not yet sent was wiped when the conversation became known: on a link to an existing conversation, text typed while it was still loading; on a new conversation, a second message typed while the first one was creating the conversation. The box now keeps that text, with the cursor at its end and the focus where it was. Nothing is sent until you send it, and a message you already sent is still sent exactly once.
- **Opening another conversation does not carry a draft across.** Text typed in one conversation, or in a new chat, stays behind when you open a different conversation, as before.
