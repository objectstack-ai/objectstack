---
'@object-ui/plugin-chatbot': patch
'@object-ui/i18n': patch
---

feat(plugin-chatbot): `QuestionCard`, the card an AI's clarifying question is answered on

Clause-②: yes (widening) — widened: `@object-ui/plugin-chatbot` exports the component `QuestionCard` and the types `QuestionCardProps`, `QuestionCardQuestion` and `QuestionCardOption`; every `@object-ui/i18n` locale pack gains the ten `chatbot.questionCard.*` strings.
Metadata-protocol: none

A pure component: the host passes the questions it parsed and receives `onAnswer(text)` or `onSkip()`. Nothing renders it yet; wiring it into the chat in the composer's place is a separate change.

- One question: a click on an option answers at once. Two questions: an option on the first moves to the second, and the second waits on Send with a one-line summary; Back keeps both choices.
- A last "Type something else…" row takes a one-line answer; typing in it clears the picked option, and Enter moves on or sends.
- The answer is the option label or the typed text for one question, and one `header: answer` line per question for two (the question text stands in for a missing header).
- Options show their description as a grey second line and a "Recommended" tag. Keys work only while focus is inside the card: 1–4 pick, ↑/↓ move, Ctrl/⌘+Enter moves on or sends. The options are a radiogroup labelled with the progress and the question, and `announce` puts "A question is waiting for your answer" into a polite live region.
- The card is right-to-left in Arabic, scrolls inside itself above a fixed button row, and keeps its choices when the host re-renders it after a failed send.
