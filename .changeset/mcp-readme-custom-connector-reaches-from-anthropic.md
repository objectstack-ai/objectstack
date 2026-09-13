---
"@objectstack/mcp": patch
---

docs(mcp): the README no longer promises that Claude Desktop reaches intranet deployments — *Add custom connector* is the claude.ai connector system and dials from Anthropic's servers (#16882)

`packages/mcp/README.md` grouped the clients by **where the client application runs**: "Local clients (Claude Code / Desktop) can reach intranet deployments; claude.ai web connectors additionally need the endpoint publicly reachable." That grouping is wrong for Claude Desktop. Its *Settings → Connectors → Add custom connector* flow is the same claude.ai connector system, and the connection to the MCP server is made **from Anthropic's servers** — Anthropic's custom-connector documentation requires the server to be reachable over the public internet from Anthropic's IP ranges and states that a server on a private corporate network, behind a VPN, or blocked by a firewall will not connect. An operator following the old sentence pointed Claude Desktop at an intranet address and the failure surfaced inside a third-party client, with nothing to connect it back to our instructions.

The README now groups by **where the connection is made from**, which is the mechanism and does not go stale when a client's dialog is redesigned:

- **Claude Code** (`claude mcp add`, or the plugin) dials the endpoint from your own machine, so `localhost` and intranet-only deployments work — this is the door that genuinely reaches a private deployment, and the README now names it as such.
- **claude.ai (web) and Claude Desktop** go through the one claude.ai custom-connector system and need public HTTPS; a locally trusted certificate does not make a private address reachable.

Documentation only — no exported symbol, endpoint, schema or runtime behaviour changes. The `patch` bump is because `README.md` is in this package's published `files[]`, so the corrected text ships to the npm page.
