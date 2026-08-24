---
"@objectstack/runtime": minor
---

**BREAKING (authorization):** `POST /api/v1/automation/:name/toggle` now requires the `manage_metadata` capability. A caller that holds a session but not that capability is answered **403 `PERMISSION_DENIED`** where it previously received **200** with the flow's enablement changed.

This narrows what the API accepts, so it ships as `minor` with the breaking surface named rather than as a `patch`.

<!-- adr-0087: not-required (no-migration-prescription) An authorization narrowing only: no spec schema, no authorable metadata key and no runtime interface is removed or renamed, so there is no tombstone, no schema rejection and nothing for `objectstack migrate meta` to rewrite. The upgrade action is operational — grant `manage_metadata` to the principals that toggle flows — which no migration entry can perform on an upgrader's behalf. -->

**The exact surface that moves**

| | before | after |
|---|---|---|
| authenticated caller **with** `manage_metadata` | 200, flow toggled | 200, flow toggled — unchanged |
| authenticated caller **without** it | 200, flow toggled | **403 `PERMISSION_DENIED`**, `toggleFlow` never entered |
| anonymous caller | 401 | 401 — unchanged, the #5519 floor still answers first |
| engine self-invocation (`isSystem`) | 200 | 200 — unchanged |

Nothing else on the domain moves. The execution doors keep their posture: `POST /:name/trigger`, the legacy `POST /trigger/:name` and `POST /:name/runs/:runId/resume` are untouched, so ordinary members can still run the flows built for them. The reads are untouched. `GET /automation/_status` still serves enablement to any authenticated caller — this change is about mutating the bit, not observing it.

**Why enablement joined the metadata write set**

#10145 gated the automation definition writes (`POST /`, `PUT /:name`, `DELETE /:name`) and deliberately left `toggle` out in the open, because whether disabling a flow is authoring or operating is a product call. It was filed, measured over HTTP, and ruled on 2026-08-23.

The measurement is why "it is engine state, so leave it" did not survive: **the enabled bit is not a row, so no organization wall scopes it.** `toggleFlow(name, enabled)` writes an in-process map keyed by flow name only, `getFlowRuntimeStates()` reads that same map with no caller and no organization, and the automation service is one instance per environment. On a real, non-degraded `isolated` posture, a tenant org owner without the capability — refused 403 by `PUT /meta/:type/:name`, `POST /automation` and `DELETE /automation/:name` at the same session — switched a shipped flow off, and an unrelated tenant in a **different organization** plus the platform admin both read it off, symmetrically in both directions. Disabling a shipped flow is functionally equivalent to deleting it for as long as it stays off, and `DELETE /:name` was already gated. Mitigating but not exculpating: the override is process-local, so a cold boot reads `enabled: true` again.

**No new capability name was minted.** The change is one arm on the existing `isFlowAuthoringWrite` predicate in `packages/runtime/src/domains/automation.ts` — the #10145 author wrote that as a single function precisely so this ruling would be one edit rather than a fourth copy of the policy. Fail-closed by construction, exactly like its three siblings: an absent `executionContext`, an absent `systemPermissions` or an empty one all refuse, and the gate runs ahead of the body checks so a refused caller learns nothing about the toggle contract.

**Migration.** A caller that toggles flows programmatically — `client.automation.toggle(name, enabled)` — must present a principal holding `manage_metadata`; the same capability its `create` / `update` / `delete` neighbours have required since #10145. No caller of this route was found in this repo, in the Console UI (`objectstack-ai/objectui`, which posts only `/trigger` and `/resume` and merely *displays* enablement), or in the example apps, so the expected migration surface is programmatic SDK callers rather than end-user UI.
