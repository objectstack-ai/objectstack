---
'@objectstack/mcp': patch
'@objectstack/runtime': patch
---

feat(mcp,runtime)!: MCP names a package's skill, agent and action by its address — prompts and `list_actions` carry the derived AI face, `run_action` takes an optional `namespace`, and a bare name two packages hold is refused instead of picked

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped and no stored row changes shape: what moves is the name the MCP surface serves a package-held skill prompt under and its answer to a bare name two packages hold. Nothing at rest records either, so there is nothing for a migration to rewrite. -->

**BREAKING** for an MCP client that reads a package-held skill prompt by the name `prompts/list` used to serve, or that runs an object-less action, skill prompt or agent by a bare name two installed packages both declare. Measured first-party census: skills 0, agents 0, object-less action names held by two first-party packages 0 (36 `defineAction` names across the examples, each held by one package). An environment-authored item and a name only one package holds answer exactly as before.

What changes, and what to write instead:

- FROM a package-held skill prompt listed as its bare `NAME` TO the same prompt listed as its AI face, `NS-NAME` (`deriveAiFaceName`, `@objectstack/spec/ai`). `prompts/get` takes the face, and still takes the bare `NAME` while one package holds it.
- FROM `prompts/get NAME` answering the first of two packages' skills TO a `-32602` refusal (`RESOURCE_CONFLICT`, 409) naming both packages and both faces; get the one you mean by its face.
- FROM `agent_prompt { agentName: NAME }` answering for an agent name two packages hold TO a refusal naming both; pass the agent's face (`NS-NAME`) as `agentName`.
- FROM `run_action { actionName }` running one of two packages' object-less actions of that name TO a `RESOURCE_CONFLICT` (409) refusal naming both packages; pass the `namespace` `list_actions` shows on the row you mean.

New, and additive: `list_actions` rows carry `namespace` (the holding package's manifest namespace) and `face` (`NS-NAME`, `OBJECT-ACTION` for an object-bound action, the bare name for an environment item); `run_action` takes an optional `namespace`, the exact qualifier: only that package's declaration answers, and a namespace no installed package has is refused by name. A face two items derive is never served as one of them: `list_actions` names it once under `refusedFaces` and leaves it off both rows, and a prompt face two skills or agents derive answers a refusal naming both, with a boot warning naming both.
