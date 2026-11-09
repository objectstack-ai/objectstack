---
'@object-ui/plugin-chatbot': patch
'@object-ui/app-shell': patch
---

fix(plugin-chatbot,app-shell): after 确认 or 取消 on the chat's confirm card, the follow-up sent to the model no longer shows as the person's own message

Clause-②: no
Metadata-protocol: none

After the operator confirmed or cancelled an action on the chat's confirm card, the chat sent the model a short follow-up («[HITL pa_…] The operator approved the `update_record` call … Acknowledge the outcome …») through the ordinary user-message channel, so the person saw it as their own bubble, after a reload too, and the conversation list showed it as the conversation's preview. The model still receives that follow-up unchanged. What changed is who reads it as the person's words: the chat transcript draws no bubble for it (live, after a reload, and on a shared transcript), the conversation list previews the person's last ask instead, and the conversation-language probe no longer reads it as the person's latest turn, which turned a Chinese conversation's outbound text English when the action's result carried no Chinese. The follow-up is recognised by its leading `[HITL <id>]` tag, the one part of a stored message that survives a reload; `@object-ui/plugin-chatbot` exports the reader as `isHitlContinuation` (also from `./core`). An ordinary message is sent, drawn and previewed as before.
