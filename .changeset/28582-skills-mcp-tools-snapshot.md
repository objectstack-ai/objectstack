---
'@objectstack/skills': patch
---

docs(skills): the automation skill's `mcp` recipe teaches the `providerConfig.toolsSnapshot` pin

Clause-②: no
Metadata-protocol: none

- **Before.** `providerConfig.toolsSnapshot` (a sha256 pin per MCP tool, checked on every materialization) shipped in `@objectstack/connector-mcp` and on the connectors page, but no published skill named it. An agent authoring an MCP connector app from the skills declared `include` alone, with no protection against a server silently rewriting a tool's description or `inputSchema`.
- **Now.** `skills/objectstack-automation/references/integration-recipes.md`, recipe 2 (remote MCP), gains one paragraph: what `toolsSnapshot` pins and that a pinned name `include` leaves out is refused at boot; where the digests come from (`computeMcpToolsSnapshot(tools)`, or the served digest the degraded reason prints against a placeholder pin); what an author sees when a pin no longer matches (the instance degraded with no actions, `CONNECTOR_UPSTREAM_CHANGED`, the reason on `GET /api/v1/automation/connectors` naming each tool and the digest it now serves), and the link to the connectors page's pin section.
- The file stays under its token ceiling: the paragraph is paid for by deleting restatements in the same file that keep a home elsewhere (the `connector_action` row of `SKILL.md`, its `api`-trigger *Signature* bullet, the objectstack-platform skill's `plugins:`/`requires` rule, and the connectors page). No ceiling moves, no frontmatter, schema, key or behaviour changes.
