---
'@objectstack/skills': patch
'@objectstack/mcp': patch
'@objectstack/service-analytics': patch
---

fix(ask): an AI client sends the user's whole phrase to `list_datasets`, and re-sends a word it cut or reworded instead of asking the user about it

Clause-②: no
Metadata-protocol: none

An AI client answering a business question through the governed datasets often sent a shortened word ("claims" for "number of claims", "amount" for "claimed amount"). The server offers such a word only possible readings, never a match, so the client asked the user which number they meant on a question that already named it.

- `list_datasets`' `nextStep.note`, in all four languages, now says before the question: a word the client cut out of a longer phrase of the question, or reworded, is not asked about; the client calls `list_datasets` once more with that phrase as the user wrote it, never the whole question, and asks only when the word is the user's own. The answer to that second call is followed like any other: a phrase that matches nothing and has no candidate takes the labelled fallback to the object tools. `matches`, `candidates`, `decision` and `terms` do not change, and a measure candidate for the user's own word is still asked about, never selected.
- `list_datasets`' description and the MCP `initialize` selection rule say the same, and ask for the question's business phrases whole, as the user wrote them.
- The `objectstack-ask` skill (and `GET /mcp/skill`, generated from it) asks for one term per thing, its whole noun phrase without the verbs and question words around it, with one worked example.
