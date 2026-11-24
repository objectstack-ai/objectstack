---
'@objectstack/runtime': patch
---

feat(runtime): the open MCP server lists metadata and pending drafts for an OAuth client with `metadata:write` whose user holds `manage_metadata`

Clause-②: yes (widening)
Metadata-protocol: none

An AI client connected over MCP with an OAuth token that carries `metadata:write` now gets three read tools on a self-hosted runtime, the first half of the open draft door (design `docs/design/mcp-local-first-door.md`, Design A):

- `list_metadata_items({ type, state? })` lists one metadata type's items as summaries (name, label, package). A pending draft is listed in place of its published version and marked `draft: true`; `state: "active"` lists the published items only, `state: "draft"` the pending drafts only. A type the platform does not declare is refused with `400 INVALID_REQUEST`, as the `/meta` list refuses it.
- `get_metadata_item({ type, name, state? })` reads one item's full definition: the pending draft where one exists, unless `state` selects the draft or the published version. An item that does not exist answers `404 RESOURCE_NOT_FOUND`.
- `list_drafts({ package? })` lists the pending drafts, optionally for one package.

The tools are served only where both halves hold: the token consents (`metadata:write`) and the user the token was issued to holds `manage_metadata` in the organization the token bound. The user's capability is read from their own grants on each request, because an OAuth agent's envelope carries no system permission without `actions:execute`. A token whose user lacks the capability is listed none of the three tools, and a call that reaches them anyway is refused `403 PERMISSION_DENIED`. A token without `metadata:write`, an API key and a session see none of them, as before. When the user's grants cannot be read, the tools are not served on that request and the runtime logs one warning.

The reads withhold what every `/meta` door withholds from that user, judged by the same read gates with the user as the caller: a dashboard, a list view or an app whose `requiredPermissions` the user does not hold, and a book or doc outside their audience, are refused `403 PERMISSION_DENIED` by `get_metadata_item` and left out of `list_metadata_items`. Before either gate, both reads ask the type-level read admission every `/meta` read asks: a metadata type the user may not read is refused `403 PERMISSION_DENIED` on both, whatever its spelling or `state`. Holding `manage_metadata` does not lift these refusals. A gate that cannot evaluate refuses the read.

The read tools are named `list_metadata_items` and `get_metadata_item`, not `list_metadata` and `get_metadata`, because `list_metadata` is a hosted platform tool. Nothing here writes: saving and discarding drafts, and the publish verdict a save answers with, come in a later change.
