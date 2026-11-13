---
'@objectstack/mcp': patch
---

Clause-②: yes (widening)
Metadata-protocol: none

MCP `run_action` and `resume_run`: a flow run that failed on a declared refusal now names the reason to tell the user. The tool error keeps its envelope in the first text block exactly as before (`FLOW_FAILED`, the flow and node message, `details`), and adds a second text block with the sentence the console's toast reads, chosen in the console's order: the flow's `errorMessage`, else `userMessage`, else `details.innerRefusal.message`. A failure that met none of these gets no second block. The two tool descriptions teach the same order, so an agent relays "Invoice is required" instead of "Flow 'F' failed: Node 'N' failed: update_record(…) failed: …".

A client that joins every text block before parsing JSON must read the first block alone for the envelope.
