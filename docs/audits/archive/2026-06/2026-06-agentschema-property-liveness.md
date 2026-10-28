# Audit: AgentSchema property liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/ai/agent.zod.ts`. **Consumers**: framework `service-ai/agent-runtime.ts` (+ agent/assistant routes, eval-runner); objectui `AgentPreview` (display) + chatbot (picker).

## 🔴 Model provider drift — `model.provider` is DEAD
Runtime applies only `model.{model,temperature,maxTokens}` (`agent-runtime.ts:264-266`). **`model.provider` and `model.topP` are never applied** — the provider/model comes from the configured AI adapter (`plugin.ts`), so an agent setting `provider:'anthropic'` has **zero effect**. (`AgentPreview.tsx:124` displays provider, reinforcing the false impression.)

## 🔴 The entire "autonomy" surface is aspirational except one knob
**DEAD** (no runtime reader; only authored + displayed in AgentPreview): `memory.*` (shortTerm/longTerm/reflectionInterval), `guardrails.*` (maxTokensPerInvocation/maxExecutionTimeSec/blockedTopics — real limits enforced by an unrelated quota service), `structuredOutput.*`, `lifecycle` (StateMachine), `planning.strategy`, `planning.allowReplan`. **The only LIVE planning sub-field is `planning.maxIterations`** (3 call sites).

## 🔴 Access control declared but UNENFORCED (security gap)
`access`, `visibility`, `tenantId` — none read at runtime. `permissions` is display-only; the chat route **hardcodes `['ai:chat','ai:agents']`** (`agent-routes.ts:109`) regardless of the agent's declared `permissions`. So **"who can chat with this agent" is currently a no-op** — a latent access-control gap. (`visibility` defaults `organization` but gates nothing.)

## Drift
**`knowledge`** — spec defines `{topics,indexes}` but the only consumer (`AgentPreview.tsx:213`) reads `knowledge.sources`/`indexes`, and **no runtime reads it at all** — RAG is wired via `service-knowledge`, not `agent.knowledge`. Chatbot picker `description` is derived from `role` (not an AgentSchema field).

## LIVE & necessary
`name`, `label`, `role`, `avatar`, `instructions` (core), `model.{model,temperature,maxTokens}`, `skills` (→ tools+prompt), `tools` (legacy fallback), `active` (gates listing + 403 on chat), `planning.maxIterations`, `protection` (loader).

## Recommendation
Either route `model.provider`/`topP` into the LLM call or remove them (currently misleading). **Enforce `permissions`/`visibility`/`access`** at the chat route, or stop accepting them (security). Prune the aspirational autonomy surface (memory/guardrails/structuredOutput/lifecycle/planning.{strategy,allowReplan}) or mark `experimental`. Fix the `knowledge` shape drift.
