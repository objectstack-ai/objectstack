---
'@objectstack/skills': patch
---

docs(skills): the platform skill teaches `os environments use-runtime` and `os mcp connect`

Clause-②: no
Metadata-protocol: none

`objectstack-platform`'s operations reference gains two rows and two clauses. `os environments use-runtime <url> --token <key>` makes a self-hosted runtime the deploy target: the key is tried on the runtime first (`--no-verify` skips that), kept in `~/.objectstack/cloud.json` (0600) across cloud login and logout, and `--forget` or `os environments switch` targets the cloud again. The `os deploy` row says how it deploys to that runtime (build, dry-run plan, inline install, live on `hotLoaded`, `--confirm-access-upgrade`), and the `os package install` row says it falls back to that runtime with no `-u`. `os mcp connect` registers an environment's MCP server with Claude Code, `--url` for a self-hosted or local server (named `objectstack`), `--name`, `--print`, and stores no token. Paid by cutting restatement in the same file and two rows that misstated `os login` and `os register`. Two new eval cases cover the commands. The CLI behaviour already shipped; this release only teaches it.
