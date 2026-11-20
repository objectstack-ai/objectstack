---
'@objectstack/mcp': patch
---

feat(mcp): export the app-docs answer-order rule and its served-check from the package barrel

Clause-②: yes (widening)
Metadata-protocol: none

`@objectstack/mcp` now exports `packageDocAnswerRule(definitionReader?)`, `packageDocToolsServed(bridge, options)`, `definitionReaderOf(toolNames)` and `DEFINITION_READER_TOOL_NAMES`. A host that writes its own `initialize` text (`instructions` / `dataOnlyInstructions`) can carry the same "read the manuals first, end with sources" rule the open server appends to its default text: send it where `packageDocToolsServed` is true, naming the reader `definitionReaderOf` picks from the tool names the connection lists. The open server calls the same exports, so there is one copy of the sentence. Nothing else changes.
