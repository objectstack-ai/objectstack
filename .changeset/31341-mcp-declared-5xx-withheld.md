---
'@objectstack/mcp': patch
---

Clause-②: no
Metadata-protocol: none

The MCP record data tools (`query_records`, `aggregate_records`, `get_record`, `create_record`, `update_record`, `delete_record`, `delete_records`' selection read) and the `objectstack://objects/{name}/records/{id}` resource now answer a coded throw that declares a 5xx the way `/api/v1/data` does. The code and status are kept and the producer's sentence is withheld (`Internal server error`), unless the throw marks itself `refusal: true`; the thrown text is logged once on the server. They used to hand the agent the producer's own sentence. An unregistered code with a declared 5xx answers the status's closed code, as at the door, which names the producer's spelling only in `declaredCode`, a member no MCP face serves. A declared refusal status (below 500) keeps its coded answer unchanged.
