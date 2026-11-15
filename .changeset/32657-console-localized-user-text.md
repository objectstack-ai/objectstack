---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/data-objectstack': patch
---

fix(console): a metadata save's advisories and refusals show the server's sentence in the user's language

Clause-②: yes (widening)
Metadata-protocol: none

**Advisory toast.** After a save or publish, each advisory finding that carries a `userMessage` (the sentence the server composes for the person who saved, in the request's language, else the workspace default, else English) shows that sentence after its rule id and location, in place of the developer-facing English `message` and `hint`. A finding the server wrote no sentence for keeps the `message` and `hint`.

**Refused save.** The issues of a `422` refusal from the runtime authoring gate carry the same `userMessage`. `formatMetadataIssue` (and so `formatMetadataError` and the Studio publish-failure list) shows it after the issue's path in place of the English `message`, and Studio's refusal sentence carries it verbatim instead of reading the English `message` through the console's own validation-message table. A spec-validation issue carries no `userMessage` and is shown as before.

**Type.** `MetadataValidationIssue` on `@object-ui/data-objectstack` gains the optional `userMessage`, typed from `RuntimeAuthoringIssue['userMessage']` in `@objectstack/spec/api`.
