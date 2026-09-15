---
"@objectstack/spec": patch
---

`liveness/agent.json`, `liveness/skill.json` and `liveness/action.json` — the 21 cloud citations these ledgers rest on now carry the date they were read and the symbol they were read at, and the two claims that reading falsified are corrected in the prose (#13272).

The ledgers ship inside this package, so the pointers an upgrading reader follows are these. Until now they named a package root and nothing else: `cloud: packages/service-ai/src/agent-runtime.ts`, with no date and — after #13309 repointed them off a path that existed in neither repository — still no evidence that anybody had opened the file. Every row was re-read in a cloud checkout at cloud `@cb8ee7ff60c097cc21a584fe9caf8ef4391cc0e8` and now carries `verifiedAt: 2026-09-15`, `evidenceScope: "cross-repo"`, and a `#symbol` anchor on the consuming function.

- **A symbol instead of a line, because a line rots in range.** Three of the cited line numbers had already drifted onto unrelated prose (`agent-runtime.ts:264`, `agent-access.ts:50`, `action-tools.ts:535`) while every mechanical check kept passing. A symbol moves with the consumer and goes red when the consumer is renamed or deleted.
- **The framework half is now gate-checked.** `packages/mcp/src/skill-prompts.ts#projectSkillPrompt` is a repo-local anchor in five skill rows — the `;` before it ends the `cloud` realm's scope — so `check:liveness` resolves it against the file on every run, where the old parenthesised `(projectSkillPrompt)` was prose no check read. Cloud anchors are counted, never resolved, which is why the date on them is load-bearing.
- **Two ledger assertions were false and are repaired.** `agent.role` was noted as *"persona → system prompt."*: it reaches `AgentSummary` through `listAgents` and nothing else — `buildSystemMessages` never reads it. `agent.planning` was cited at `agent-runtime.ts`, which does not read the key at all; its three readers are `routes/agent-routes.ts`, `routes/assistant-routes.ts` and `eval/eval-runner.ts`.
- **One row is deliberately left unstamped.** `agent.tools` was falsified by the same read — zero consumers in cloud, and this package's own `AgentSchema` already declares the key `retiredKey(...)`. Its verdict is a liveness re-grade rather than a stamping decision, filed separately as #18304; a `verifiedAt` there would certify the wrong thing.

No verdict moved and no schema changed: this is the evidence layer of the ledger, and `check:liveness` reports the same 505 repo-local paths resolving as before with five more anchors now checked.
