---
'@objectstack/metadata-core': patch
'@objectstack/rest': patch
'@objectstack/runtime': patch
---

fix(rest, runtime)!: the /meta action doors and MCP list_actions serve an action entry as the object door projects it (ADR-0106)

Clause-②: no (narrowing) — the `/meta` `action` reads (the list, the item read, `/layers` with its `?layers=true` spelling, and `/published`, on both transports) and MCP `list_actions` now answer a caller only the action entries the `/meta` object door's projection serves that caller, which ADR-0106 D1 ("a field the caller cannot read does not exist for that caller, on any plane") already promises, so no stated contract is narrowed; what narrows is the answer to a caller with a `readable: false` field. Nothing is widened: no answer member, error code or status is added; the new exports are the shared projection the doors ask.
Metadata-protocol: none
Skills-docs: no move — `skills/**` teaches no `/meta` action read; `content/docs/ai/connect-mcp.mdx` and `content/docs/deployment/environment-variables.mdx` state the projection.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema and no stored shape changes: the action doors answer a field-restricted caller the action entries the metadata object door already serves them. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a field-restricted caller of the `/meta` `action` reads and of MCP `list_actions` over HTTP (`/api/v1/mcp`).

- **Now.** Each standalone `action` entry the `/meta` doors serve is projected through the object door's ADR-0106 posture and projection for this caller, as its own object's only action (`projectMetaActionForCaller` in `@objectstack/rest`, the one rule every action door asks). Each param is judged on the object it names: its `objectOverride` when set, else the action's `objectName`. An entry that projection withholds is left out of `GET /api/v1/meta/action`, and `GET /api/v1/meta/action/:name`, its `/layers` (and `?layers=true`) and its `/published` answer it exactly as they answer a name with nothing behind it. A layered read with any layer withheld is answered that way too. The cached item arm judges a conditional request after that projection, so a withheld entry is never answered `304`.
- **Object-less actions.** An action with no own object (a `global` action) whose `objectOverride` param binds a field the caller cannot read on the object it names is withheld the same way, on the `/meta` doors and in MCP `list_actions`.
- **Param summaries.** MCP `list_actions` summarises a param bound through `objectOverride` with the field of the object it names (its label and type), not the action's own object's field of the same name; a target that names no object the bridge holds is summarised as before.
- **Refusal.** Where the caller's field visibility on an action's own object cannot be evaluated, or the projection would leave that object with no field, the read is refused as the object door refuses it: `FIELD_VISIBILITY_UNRESOLVED` / 503.
- **Unchanged.** A caller who may read every field, a D4-exempt caller (`manage_metadata`, the system context) and a deployment with no `security` service or with the mask switched off are answered byte for byte as before; so is every action whose params bind only readable fields, or none. The run doors (MCP `run_action`, `POST /actions`) and their param validation and refusal text are unchanged.
