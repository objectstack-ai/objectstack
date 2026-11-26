---
'@object-ui/app-shell': patch
---

fix(studio): Save waits for an expression's check to reach the page before it sends, so a predicate that does not parse is held, not saved, on a busy machine too

Clause-②: no
Metadata-protocol: none

Studio's top-bar Save reads whether an edit is held (a formula, rule guard or action predicate that does not parse) once the expression checks of the last keystroke have run. It waited a fixed 50 ms past the check's delay, but an action predicate's verdict reaches the object's Save through several renders (the expression field, the condition builder, the action inspector, the actions panel, then the Data pillar), and on a busy main thread those renders came after the 50 ms: Save read the verdict from before the edit and sent the unparsable predicate. Save now also waits until every render already queued has run, so it reads the verdict of the text it is about to send. A Save pressed after the check has reported is not slower; one pressed while renders are pending waits for them.
