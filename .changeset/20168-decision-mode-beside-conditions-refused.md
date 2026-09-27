---
"@objectstack/spec": patch
---

`DecisionConfigSchema` refuses `mode` on a `decision` that also declares a non-empty `conditions` list (#20168). `mode` belongs to the edge-branched decision alone: a `conditions` list is first-match on its own, so a `mode` beside one would be accepted and never read, and `mode: 'inclusive'` there would promise every matching branch while the run takes one.

Clause-②: no

This corrects a key that has not been released yet, so it narrows no published accept set. Timing, measured when this landed: the npm registry's `latest` `@objectstack/spec` is `17.4.0`, and its `json-schema/automation/DecisionConfig.json` declares `conditions` only, with `additionalProperties: false`. No `mode` was published. The Version Packages PR (`chore: version packages`) is open and unmerged. `mode` reaches its first release together with this refusal, so no ADR-0087 entry is owed.

- **The refusal**: one issue at `mode`, for either member. It reads "`mode: 'inclusive'` is not valid on a decision that declares a `conditions` list — `mode` belongs to the edge-branched decision alone." and names the two ways out:
  - delete `mode` and keep the list;
  - or move the branches onto the out-edges (a `condition` on each branch edge, `isDefault: true` on the fallback), delete `conditions`, and keep `mode`.
- **Left alone**: `mode` on an empty `conditions` list, `mode` with `conditions` absent, and a `conditions` list with no `mode` all parse as before. A `mode` outside `'exclusive' | 'inclusive'` still gets its own value refusal first.
- **Where it binds**: the doors that parse `DecisionConfigSchema`. Today that is a direct parse, including the `SCHEMALESS_NODE_CONFIG_SCHEMAS.decision` handle. `decision` config is still export-only, so a flow's registration and `os validate` do not run it yet. The published JSON Schema cannot state the rule, because no arm of the closed refinement projection fits it. `automation/DecisionConfig` therefore joins `dropped-refinements.baseline.json` and carries the site as `x-dropped-refinements`.
