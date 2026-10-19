---
'@objectstack/mcp': patch
---

Clause-②: no

fix(mcp): the known-partial listing warning and the Connect-an-Agent bundle description say "this system"

- **What changed.** Inside the running system, user-facing copy names the system the caller is in as "this system". The warning an MCP client receives with a known-partial object listing (the `objectstack://objects` resource and the `list_objects` tool) now says "this system declares at least that many objects, possibly more", and the Connect-an-Agent UI bundle's description ends "for connecting MCP clients to this system".
- **Unchanged.** The `SERVICE_UNAVAILABLE` code that marks a partial listing, every payload shape, the portable `SKILL.md` (which names the deployment an outside agent connects to), and server log lines.
