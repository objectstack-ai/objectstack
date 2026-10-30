---
'@objectstack/connector-mcp': minor
---

fix(connector-mcp)!: a declarative `mcp` instance refuses a `providerConfig.include` it cannot read, and an entry naming a tool the server does not list, instead of exposing every tool

Clause-②: no (narrowing)
Metadata-protocol: narrowed

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped: `providerConfig` is an open record the `mcp` provider reads itself, and `include` keeps its name and its allowlist meaning, now the same as the `openapi` provider's. What changes is that two values the provider used to drop silently are refused at materialization, each with a message naming the entry and the fix, so there is nothing for a metadata migration to rewrite and no tombstone. -->

**BREAKING** accept-set narrowing of `providerConfig.include` on `provider: 'mcp'` connector instances (`@objectstack/connector-mcp`).

- **Before.** An `include` that was not an array (a string such as `include: 'web_search'`, an object, `null`) was dropped and read as "no allowlist": the instance exposed **every** tool the server lists. Non-string entries were filtered out silently (`['web_search', 7]` exposed `web_search`). An entry naming a tool the server does not list was ignored: `include: ['nope']` brought the instance up `ready` with no actions and no error.
- **Now.** `include` keeps the `openapi` provider's meaning: absent means every tool; otherwise it must be an array of non-empty tool names.
  - Any other shape is refused before connecting, with `connector-mcp provider: connector 'NAME' providerConfig.include must be an array of tool names (strings): ...`.
  - An entry the server's `tools/list` does not carry is refused after listing, naming the entry and the tools the server lists (`... providerConfig.include names 'nope', which the MCP server does not list. ...`); the connection is closed first.
  - Both are configuration faults, thrown plain: fatal at boot, a skipped entry on a reload. The instance never falls back to exposing every tool.
- **Who sees it.** An app whose `mcp` connector instance writes `include` as anything but an array of tool names, or lists a tool its server does not (a typo, or a tool the server renamed or dropped).

**The remedy.** Write `include` as an array of the server's tool names (`include: ['web_search']`), or remove it to expose every tool. For an entry the refusal names, use a name from the tool list the refusal prints, or delete the entry.
