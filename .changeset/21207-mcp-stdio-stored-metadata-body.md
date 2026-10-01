---
'@objectstack/mcp': minor
---

fix(mcp)!: the MCP stdio transport serves a stored metadata body only as its type's read projection, and refuses to evaluate it

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) the MCP stdio transport's engine-only reader (its query, get and aggregate verbs and its record resource) now serves a stored metadata body through the stored-metadata-body family's one projection, and refuses a group, filter, sort or aggregate member on the stored body column — the posture the generic data door already takes. No authorable key, spelling, export or stored shape moves, and no stored row is read differently by any metadata consumer. The other categories are closed on facts: the package publishes (not `unpublished`); no ADR-0087 id covers a served body projection or a refused query shape on this door (not `registered` / `already-registered`); and the change is runtime behaviour, not a declaration (not `runtime-interface-only` / `type-surface-only`). -->

**BREAKING**: this narrows what one door serves and accepts for the two stored-metadata tables (the stored row and its version history). On the MCP stdio transport, a read now carries the stored body as its type's read projection instead of the stored bytes, and a call that would evaluate the stored body is refused. It ships as `minor` under the launch-window convention for accept-set narrowings. No export or published type changes.

**What changes.**

- **Reads.** The stdio bridge's query and get verbs, and the record resource, serve the stored body through the same projection the generic data door and every metadata read serve: stored credential material is withheld, a body that cannot be judged is omitted, and a credential-free body is served unchanged.
- **Evaluate shapes.** A group, filter, sort or aggregate member on the stored body column is refused with `400 INVALID_FIELD` before the engine runs — the data door's code and envelope.

**What stays answerable.** Every scalar column of the two tables is still served, filtered, sorted, grouped and counted; only the stored body column is affected, and every other object is unchanged. A member's read of these tables is refused as before.
