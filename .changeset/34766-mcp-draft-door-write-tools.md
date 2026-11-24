---
'@objectstack/runtime': patch
'@objectstack/mcp': patch
---

feat(runtime,mcp): the open MCP server saves and discards metadata drafts, and every save answers with what publishing the draft would say

Clause-②: yes (widening)
Metadata-protocol: none

The open draft door on a self-hosted runtime gains its write half. It is served to the same OAuth clients as the read tools: the token carries `metadata:write` and its user holds `manage_metadata`.

- `save_metadata_draft({ type, name, item, package, ifMatch? })` saves `item` as a pending draft in `package`, recorded as an MCP save by the token's OAuth client. The reply carries `saved` (type, name, package, state, version), `verdict` and `review`. `verdict` is what publishing the stored draft would say: `publishable`, `refusals` (the issues a publish would refuse the draft on) and `advisories`, each with `rule`, `path`, `message`, `hint` and `severity`. `review` holds the Console routes where a person reviews and publishes the draft in Studio. `ifMatch` is the version the save expects to replace; a stale one is refused as the `/meta` draft save refuses it.
- A save that names no `package` is refused `400 VALIDATION_ERROR`, and nothing is saved. The refusal names the writable packages in that environment.
- `delete_metadata_draft({ type, name, package? })` discards a pending draft. The published version, if any, is left as it is.
- `list_drafts` now gives each draft its `verdict`. A draft the user may not read (for example a dashboard whose `requiredPermissions` they lack) is listed with `verdict: null` and the reason it was withheld.

A plural type spelling (`dashboards`) is folded to its singular before any gate, verdict or write, as the `/meta` doors fold it. Both writes ask the type-level write admission every `/meta` write asks, so a metadata type the user may not write is refused `403 PERMISSION_DENIED` and nothing is written; a verdict, on a save or a listed draft, is withheld for a type the user may not read. A tenant whose catalog is walled refuses both writes `403 PERMISSION_DENIED`, as the `/meta` write path does; a platform admin is admitted. Nothing on this server publishes: there is no publish tool and no `force`.

When the authoring tools are listed, the open server's default `initialize` instructions add one paragraph saying that they save drafts only and that a person publishes in Studio. The paragraph is absent when the tools are not served, and a host's own instructions replace the default text as before.
