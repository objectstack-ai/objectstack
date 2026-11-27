---
'@objectstack/spec': minor
---

feat(spec): the ask-question envelope a question tool's result carries, and `parseAskQuestionEnvelope`

Clause-②: yes
Metadata-protocol: added

- New in `@objectstack/spec/ai`: `AskQuestionEnvelopeSchema` (`{ success: true, status: 'asked', reply, preface?, questions }`), `AskQuestionSchema` and `AskQuestionOptionSchema`, with the `AskQuestionEnvelope` / `AskQuestion` / `AskQuestionOption` types and their `…Parsed` pairs. One or two questions, two to four mutually exclusive options per question, labels unique within a question, at most one option `recommended`; the length limits are exported as `ASK_QUESTION_LIMITS`. Every level is closed: an unknown key is refused, never dropped.
- `parseAskQuestionEnvelope(value)` takes an already-unwrapped tool result and answers the parsed envelope, or `null` for anything that is not one; a `null` means the console shows the result as text. It also reads the legacy `ask_which` result `{ success: true, status: 'asked_which', question, readings, reply }` as one question whose options are the readings, held to the same limits.
- Nothing produces the new envelope yet; the console's question card and the question tool's new output build on it.
