---
"@objectstack/mcp": patch
---

Bridged MCP tools are now annotated from what their definition DECLARES, not from a seven-name allowlist. `registerToolFromDefinition` built both safety hints as membership tests against two literal sets (`READ_ONLY_TOOLS`, 6 names; `DESTRUCTIVE_TOOLS`, 1), so every tool outside them — every tool an app registers under its own name, and every action-backed tool (`delete_opportunity`, `void_invoice`, `archive_account`, …) — reached each MCP client as `readOnlyHint: false, destructiveHint: false`. That pair is not a missing annotation: it is a positive claim of "not read-only, and not destructive", on the one field an MCP host reads to decide whether to interrupt the user before a call, so a destructive action-backed tool arrived flagged as safe. It also inverted the protocol's own conservative default (`@modelcontextprotocol/sdk` 1.30.0 documents `destructiveHint` as `Default: true`).

The declared source is `AIToolDefinition.requiresConfirmation` — the runtime contract member that already carries the framework's one maintainer-ruled definition of destructive (`actionLooksDestructive`, #7828 Option A, whose output `summarizeAction` writes into that very field). ⛔ Nothing here restores the retired metadata key `ToolSchema.requiresConfirmation`, which ADR-0033 §2 removed and which still hard-rejects; it is a different member, on a different object, at a different layer, and no metadata author can reach the one read here.

What a `tools/list` now serves, per tool:

- **declares `requiresConfirmation: true`** → `destructiveHint: true, readOnlyHint: false` (was `destructiveHint: false`). ⚠️ Hosts will start prompting before these calls, which is the point of the change and the intended direction.
- **declares `requiresConfirmation: false`** → `destructiveHint: false`, no `readOnlyHint` (was an asserted `readOnlyHint: false`; the MCP default is `false`, so nothing changes for a conforming host).
- **declares nothing** → NEITHER hint (was `false, false`). MCP has no spelling for "unknown" other than absence, so the protocol's own defaults apply — `readOnlyHint` false, `destructiveHint` **true** — instead of a value this bridge cannot source.
- **a platform tool name** (`list_objects`, `describe_object`, `query_records`, `get_record`, `aggregate_data`, `delete_field`) → unchanged, as an explicit last-resort fallback for the names the platform itself registers, now outranked by anything the definition declares and pinned to be a subset of `PLATFORM_PROVIDED_TOOL_NAMES`.

One name left the read-only fallback: `aggregate_records` is not a platform tool name (`aggregate_data` is) — it belongs to the object-CRUD bridge, which registers it, annotated `readOnlyHint: true`, at its own site in `mcp-http-tools.ts`, so nothing loses that annotation where it is actually served. `openWorldHint: false` is unchanged for every bridged tool.
