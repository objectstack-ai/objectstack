---
'@objectstack/spec': patch
---

fix(spec): a legacy `ask_which` reading up to 60 characters reads as a question-card option

Clause-②: yes (widening) — widened: `parseAskQuestionEnvelope` now accepts a legacy `ask_which` result whose readings run up to 60 characters (it refused any reading over the envelope's 24-character label), and `ASK_QUESTION_LIMITS` gains `legacyReadingMaxLength: 60`.
Metadata-protocol: none

Real `ask_which` readings are short phrases, most of them longer than the new envelope's 24-character label, so holding them to that label left most of today's questions as plain text. A legacy reading now has its own limit, 60 characters (the envelope's description length), and becomes an option label with no description. Every other rule still applies to the legacy result: one question of at most 120 characters, two to four readings, no duplicate or blank reading, a non-empty reply. The new `asked` envelope keeps its 24-character label.
