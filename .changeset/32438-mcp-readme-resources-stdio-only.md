---
'@objectstack/mcp': patch
---

docs(mcp): the README says the `objectstack://` resources are served on the stdio transport only, and names the HTTP tools that read the same data

Clause-②: no
Metadata-protocol: none

The Streamable HTTP endpoint at `/api/v1/mcp` registers no resource: `initialize` advertises no `resources` capability, and `resources/list`, `resources/templates/list` and `resources/read` answer `-32601 Method not found`. The README listed the four resources with no transport caveat. § Resources, the Features list and § Server capabilities now say that resources are stdio-only, and that over HTTP the same reads are the `list_objects`, `describe_object` and `get_record` tools, under the same caller's principal. No behaviour changes.
