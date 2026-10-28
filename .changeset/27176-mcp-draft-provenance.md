---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/rest': patch
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(spec): a draft's per-key provenance records writes made through the MCP build door, and the OAuth client that made them

Clause-②: yes (widening)
Metadata-protocol: added

A pending draft's `draftChanges` (the strict draft read's per-key provenance) could tell Studio's AI copilot from a person in Studio and from any other caller, but not an AI agent outside the console building through a deployment's MCP build door. Such a write was recorded as `api`, and nothing said which agent it was.

- **Spec.** `MetadataAuthoringSurfaceSchema` gains `mcp`: an AI agent outside the console writing on a person's behalf through the MCP build door. A new `MetadataAuthoringClientSchema` (`{ id, name? }`) is the OAuth client the person consented to. A `draftChanges` entry carries it as an optional `client`, present only beside `by: 'mcp'`. `SaveMetaItemRequestSchema` gains an optional `client`, stated only by the MCP build door, in-process, from the token it verified.
- **The save.** A draft save with `surface: 'mcp'` stamps `by: 'mcp'` and its `client` on every key path it changes. A `client` beside any other surface, or of the wrong shape, is refused `400 INVALID_REQUEST` before anything is written. `actor` is still the person the agent writes for.
- **The HTTP doors.** `?surface=mcp` is refused `400 VALIDATION_ERROR`, as `?surface=copilot` is: only the MCP build door may state it. No HTTP door reads a `client`.
- **Studio.** The properties' draft chip and source line mark an `mcp` write as they mark the copilot's, and name the client: 「由 MCP 客户端「Claude」在 2 分钟前作为草稿加入」 / "Added as a draft by the MCP client "Claude" 2 min ago". A client that registered no name is shown as an unnamed MCP client, never by its id. The pending-changes sheet's drill-in lists which AI tools drafted part of the item, in all ten console locales.

Nothing to do for existing callers: a save that states no surface is still recorded as `api`, and an entry without `client` reads as before. The MCP build door starts stating `mcp` and its client in a later change.
