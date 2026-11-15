---
'@objectstack/mcp': patch
---

fix(mcp): the served SKILL.md tells a client what to do when the data cannot answer a question

Clause-②: no
Metadata-protocol: none

The MCP server's client instructions (the SKILL.md a host with the dataset pair serves) taught how to choose between a governed metric and an object query, but said nothing about a question no metric, object or field can answer. A client then sometimes declined and went on to fill the gap with an assumed value ("under a typical one-year warranty, none would expire"), which is an answer the data cannot support.

The dataset entries now carry one more rule: say the data does not record it and name what is missing, offer the computation if the user supplies the missing value, never fill the gap with an assumed value or a conclusion drawn from one, and take any figure added from a tool answer. Instruction text only; no tool, schema or metadata changes.
