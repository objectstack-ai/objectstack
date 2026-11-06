---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

fix(mcp, runtime)!: MCP describe_object answers the same field-masked object schema the /meta door answers (ADR-0106)

Clause-②: no (narrowing) — the MCP object-schema reads now serve a caller only the fields the `/meta` object door serves that caller, which ADR-0106 D1 ("a field the caller cannot read does not exist for that caller, on any plane") and the MCP security model ("field-level security applies to the agent exactly as it does to a person") already promise, so no stated contract is narrowed; what narrows is the answer to a caller with a `readable: false` field. Nothing is widened: no export, answer member, error code or status is added.
Metadata-protocol: none
Skills-docs: no move — `skills/**` teaches no field set for `describe_object`; `content/docs/ai/connect-mcp.mdx` states that schema discovery is covered by field-level security.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema, no export and no stored shape changes: the MCP tools answer a field-restricted caller the field set the metadata door already serves them, with a code and status already on the wire. There is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a field-restricted caller of the MCP object-schema reads, on both transports (`/api/v1/mcp` and the stdio server).

- **Now.** `describe_object`, `list_objects`' `fieldCount`, the fields `validate_expression` puts in scope (and its `label()` option-field check) and, on the stdio server, the `objectstack://objects` resources serve each object through the ADR-0106 posture and projection the `/meta` doors run (`resolveObjectSchemaMaskPosture` → `relateObjectSchemaMaskPosture` → `applyObjectSchemaMask`, `@objectstack/metadata-core`), for the same caller: a field the caller cannot read is not listed, and the D4 exemptions, the D6 tiers and the D8 switch (`OS_ALLOW_UNMASKED_OBJECT_METADATA`) are the shared posture's. The HTTP bridge asks the `/meta` door's own masker (`resolveObjectMasker` / `maskObjectSchema`, `@objectstack/runtime`); the stdio bridge asks the host's `security` service about its API-key principal.
- **Refusal.** Where the caller's field visibility cannot be evaluated, or the projection would leave the object with no field, the read is refused as the `/meta` door refuses it: `FIELD_VISIBILITY_UNRESOLVED` / 503, rendered as the tools' coded error (`{ error: { code, message, status } }`) and, on a stdio object resource, as `{ error, code, status }`. One object that cannot be projected refuses `list_objects`, as the `/meta` object list does.
- **Unchanged.** A caller who may read every field, a D4-exempt caller and a deployment with no `security` service are answered byte for byte as before. The data verbs, their gates and `list_actions` / `run_action` are untouched. The stdio object reads now resolve the API-key principal on each call, as the data verbs already do, so a revoked key is refused there too.
- **`@objectstack/mcp`** now depends on `@objectstack/metadata-core` at runtime (it was a dev dependency).
- **`@objectstack/spec`**: the error-code ledger lists `FIELD_VISIBILITY_UNRESOLVED` under `@objectstack/runtime` and `@objectstack/mcp` as well, its two new emitters. The code itself was already registered.
