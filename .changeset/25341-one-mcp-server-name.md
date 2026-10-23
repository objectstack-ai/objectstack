---
'@objectstack/mcp': patch
'@objectstack/cli': patch
---

fix(cli,mcp): `os dev`'s boot banner and the served SKILL.md name the MCP server the same way

Clause-②: no
Metadata-protocol: none

`os dev`'s "connect a coding agent" block printed `claude mcp add --transport http FOLDER URL`, where FOLDER was the basename of the directory `os dev` ran in. The served `SKILL.md` (`GET /api/v1/mcp/skill`) and the console's Connect an Agent snippets name the server `objectstack`. So one endpoint ended up in an agent's config under two names, depending on which instructions were followed.

Both producers now read one exported constant, `OBJECTSTACK_MCP_SERVER_NAME` (`'objectstack'`), from `@objectstack/mcp`. The banner's `Connect` row prints `claude mcp add --transport http objectstack URL`. If you registered the server under the folder name from an earlier banner, that entry keeps working. Remove it with `claude mcp remove FOLDER` if you also added it as `objectstack`.

`printMcpConnectHint` no longer takes a `name` option.
