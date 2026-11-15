---
'@object-ui/plugin-chatbot': patch
'@object-ui/app-shell': patch
'@object-ui/console': patch
---

fix(plugin-chatbot, console): a failed AI chat conversation create gives back every message sent while it waited, not only the last one

Clause-②: yes (widening) — `ChatbotEnhanced` (`@object-ui/plugin-chatbot`) takes a new optional prop, `unsentText`: the text a not-sent `error` gives back to the composer when the host holds what was not sent. Nothing is removed or narrowed; a host that passes nothing keeps today's restore.
Metadata-protocol: none

- **Two messages, then a failed create.** On a new AI chat conversation the first message waits for `POST /conversations`, and a second message sent during that wait joins it. When the create then failed, the message box got back only the second message, and the first was lost. The box now gets both, first part first, with the "Couldn't send your message" notice as before, and sending again sends the joined text once. This holds on the full-page AI chat, in the console's chat dock and in the Studio copilot.
- **`ChatbotEnhanced`.** The not-sent restore puts the host's `unsentText` back in an empty box when the host passes one, and the text the composer last submitted when it does not (unchanged).
