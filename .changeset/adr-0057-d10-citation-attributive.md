---
"@objectstack/lint": patch
---

docs(lint): the `readonlyWhen` field-rule diagnostic no longer cites `ADR-0057 D10` (#9255)

The author-visible consequence text for a faulting `readonlyWhen` predicate said
"Per ADR-0057 D10 the server is the one that decides". The rule it states is
correct and unchanged — the server locks the field while the form still renders
it editable — but the citation does not resolve: `D10` of the ERP-authorization
`ADR-0057` decides Setup-nav capability surfacing, and the other `ADR-0057`
(system data lifecycle) carries no D-numbered decisions at all. An author who
followed the anchor landed on an unrelated decision and had no way to tell
whether the code or their search was wrong.

The diagnostic now states the rule on its own authority, which is where it
always rested. No behaviour, no message semantics and no rule changed — only
the traceability claim. Recording the rule as an actual decision is tracked
separately in #9628.
