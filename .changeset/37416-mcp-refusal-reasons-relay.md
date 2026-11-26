---
'@objectstack/mcp': patch
---

feat(mcp): a refusal with several declared reasons names every line to the agent

Clause-②: no
Metadata-protocol: none

A hook or `script` action that refuses with a declared `reasons` list answers `userMessage` as the listed sentences joined by a line break, the code's own `message` closing them, and the `/api/v1/data` door bounds that `userMessage` at 500 characters. The record data tools (`create_record`, `update_record`, `delete_record`, and the other record tools that render the `/data` answer) serve the door's value, so on a long list an agent read a cut sentence and lost the closing line.

Every MCP tool that renders a door's `userMessage` (`run_action`, `resume_run` and the record data tools) now adds a second text block to such a refusal: every listed line, whole and in the order thrown, then the closing line. The lines are read from the error's `refusals` through `declaredRefusalLines` (`@objectstack/types`), the reader every door uses for `details.refusals`. The closing line is the part of the error's own unbounded `userMessage` after those lines; when that text does not begin with the lines, the block carries the lines alone. The first block, the coded envelope, is unchanged. A refusal with one reason, a `PERMISSION_DENIED` answer, a fault, and an answer with no `userMessage` get no second block.
