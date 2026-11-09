---
'@objectstack/runtime': patch
---

fix(runtime)!: MCP list_actions summarises each action against the object as the caller is served it (ADR-0106)

Clause-②: no (narrowing) — `list_actions` over `/api/v1/mcp` now answers a caller only the actions, and the param details, that the `/meta` object door's projection serves that caller, which ADR-0106 D1 ("a field the caller cannot read does not exist for that caller, on any plane") and the MCP security model (field-level security applies to the agent exactly as to a person) already promise, so no stated contract is narrowed; what narrows is the answer to a caller with a `readable: false` field. Nothing is widened: no export, answer member, error code or status is added.
Metadata-protocol: none
Skills-docs: no move — `skills/**` teaches no param summary for `list_actions`; `content/docs/ai/connect-mcp.mdx` states the projection.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema, no export and no stored shape changes: list_actions answers a field-restricted caller the actions and param details the metadata object door already serves them. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a field-restricted caller of MCP `list_actions` over HTTP (`/api/v1/mcp`).

- **Now.** Each action `list_actions` would list is projected through the `/meta` object door's ADR-0106 posture and projection for this caller, as its object's only action (`servedToCaller`, the projection `describe_object` uses). An action that projection withholds — a param whose `field` the caller cannot read, a param under `objectOverride` whose field the caller cannot read on the object it names, or any other position of the action that reads such a field — is not listed, as `GET /api/v1/meta/object/:name` does not serve it. A listed action's params are summarised against the projected object, so no label, help text, type or select options of a field the caller cannot read reach its summary.
- **Refusal.** Where the caller's field visibility on a listed action's object cannot be evaluated, or the projection would leave that object with no field, `list_actions` is refused as `list_objects` is: `FIELD_VISIBILITY_UNRESOLVED` / 503.
- **`run_action` naming a `sys_*` object.** That call's pre-screen admits only an action `list_actions` lists, so an action withheld above is refused there too, with the system-object sentence. No other `run_action` call consults the listing.
- **Unchanged.** A caller who may read every field, a D4-exempt caller and a deployment with no `security` service are answered byte for byte as before; so is every action whose params bind only readable fields, or none. The action collection and the run gates (`run_action`, `resume_run`) still read the declarations whole. The stdio server carries no `list_actions`.
