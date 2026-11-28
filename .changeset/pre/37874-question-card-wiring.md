---
'@object-ui/plugin-chatbot': patch
'@object-ui/app-shell': patch
---

feat(plugin-chatbot): the question card takes the composer's place when the AI ends its turn on a question

Clause-②: yes (widening) — widened: `ChatbotEnhancedProps` gains the optional `conversationId`; `@object-ui/plugin-chatbot` (and its `/core` entry) exports `QUESTION_SKIP_STORAGE_PREFIX`; `QuestionCardQuestion` and `QuestionCardOption` keep their names and shape and are now the envelope types of `@objectstack/spec/ai` (`AskQuestionParsed`, `AskQuestionOptionParsed`), with `options` still read-only.
Metadata-protocol: none

`ChatbotEnhanced` now draws the question card itself. When a turn ends on a question tool's result that `parseAskQuestionEnvelope` reads, and the envelope's `reply` is the turn's last text, the card replaces the composer:

- It shows only once the stream has ended, and never while a typed message is queued (that message is sent, and sending something else skips the question), while a write approval waits in the same turn, after a skip, or on a `readOnly` transcript. Both shapes of a tool-ended turn count: one streamed message, or the two messages a reloaded conversation holds.
- The composer stays mounted, hidden and `inert`, so a draft and its attachments come back after Skip or an answer, and focus that was in it returns to it.
- One click answers: the option label goes out through `onSendMessage` as the next user message. If the send fails and the message is rolled back, the card returns with its choice still made.
- Skip is remembered on this device, per conversation, under `objectstack:ai-chat-question-skip:` plus the conversation id. The console passes its conversation id, and signing out clears these keys with the rest of the chat cache.
- The conversation draws the question from its envelope instead of its plain-text reply: while pending, the question alone; once answered or skipped, a collapsed "AI asks: …" that expands to its options. Copy still copies the full reply, and a pending question shows no Regenerate.
