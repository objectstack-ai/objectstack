# ADR Prioritization Review

> **Date:** 2026-06-12
> **Scope:** All 49 ADRs in `docs/adr/`, cross-checked against actual code on `main`.
> **Method:** Every unfinished ADR was read in full and its `Status:` header was
> verified against the shipped code (git log + source grep), not taken at face
> value. This document records the calibrated status and a ranked next-step plan.

---

## 0. Headline finding — the `Status:` headers are systematically stale

The single most important result of this sweep: a large fraction of ADRs marked
**Proposed** or **Draft** are in fact **substantially or fully shipped** on the
framework (backend) side. What remains for most of them is the **ObjectUI**
surface (sibling `../objectui` repo) or **cloud** control-plane work — neither of
which is owned by this repo.

Consequence: prioritizing off the headers alone overstates the remaining
framework workload and hides where the real gaps are. The headers should be
refreshed (see §4).

---

## 1. Status calibration — header vs. real (framework side)

| ADR | Header | Real framework status | Remaining (and where) |
|---|---|---|---|
| 0034 transactional writes | Proposed | **Shipped** (v8.0.0 — ambient `AsyncLocalStorage` tx, batch `$ref`) | UI wiring (objectui) |
| 0032 unified expression layer | Proposed | **Shipped** (CEL, no silent-swallow, build-time validate) | designer builders (objectui) |
| 0039 concurrent durable pause | Proposed | Track A **shipped** (incl. A2 `map` node) | Track B deferred by design |
| 0042 approval SLA escalation | Proposed | **Shipped** (jobs-backed scanner, `system:sla`) | — |
| 0043 actionable approval links | Proposed | **Shipped** (single-use tokens, GET-confirm/POST-exec) | v1 non-goals only |
| 0044 approval send-back | Proposed | **Shipped** (`returned` status, typed back-edges) | designer (objectui) |
| 0041 flow trigger family | Proposed | **Shipped** (trigger-api HMAC + queue) | rename deprecation stubs (S) |
| 0015 datasource federation | Proposed | **Shipped** (3 gates + REST + CLI) | Studio UI, extra drivers |
| 0023 OpenAPI→connector | Proposed | **Shipped** (library) | CLI, examples |
| 0024 MCP connectors | Proposed | **Shipped** (library) | examples |
| 0036 app = REST + MCP | Proposed | **Shipped** framework (api-key, `/api/v1/mcp`) | cloud Integrations page |
| 0007 settings | Draft | **Shipped** backend (sys_setting, resolver, 7 manifests) | entire UI (objectui) |
| 0033 AI authoring | Accepted | A–C **shipped** | Phase D = enterprise/cloud |
| 0019 app = consumer unit | Proposed | **Shipped** (schema-enforced) | Console fills field |
| 0029 kernel object ownership | Proposed | **Substantially shipped** (K0/K1/K2/D7) | K3 (waits on 0030/storage) + K4 cleanup |

> Note on 0029: `sys` being a **shared** namespace with single-owner-per-object
> enforcement (not a reserved namespace) is the **intended** K0 design, not a gap.

---

## 2. Genuinely unbuilt framework gaps (the real candidate work)

| ADR | What | Real status | Effort | Value |
|---|---|---|---|---|
| **0025 install side** | plugin package install / registry / consent | build/sign/publish shipped; **install half missing** | L | high |
| **0027 authoring lifecycle** | openDraft→stage→diff→publish(seal)→promote→rollback orchestrator | package absent; only contract stubs | L | high |
| **0013 bidirectional messaging** | Slack inbound receiver / sessions / multi-account | **~zero code** (messaging is outbound-only) | L | high |
| **0010-nl-to-flow** | natural language → runnable Flow | **not started** (substrate ready) | L | high |
| **0028 namespace isolation** | `(namespace,type,name)` identity + physical-name derivation | **still the old prefix model** | L | med |
| **0026 client-UI plugin dist** | `runtime:'ui'` variant + iframe sandbox | unbuilt, **blocked on 0025** | L | med |
| 0046 package docs as metadata | `src/docs` → `manifest.docs` | unbuilt, but P0/P1 cheap | S–M | med |
| 0010 protection L4 / unlock | `frozenPaths` evaluator + unlock RBAC | L3 + audit shipped; **no escape hatch** | M | med |
| 0017 view Phase 5 | view RLS backend + designer | RLS still **client-enforced**; designer in objectui | S (backend) | med |
| 0040 unified assistant | tool-scoping enforcement + blueprint scale gate | still advisory; scale gate **not implemented** | M | med-high |
| 0029 K4 | remove migration-era empty barrels | cleanup only | S | low-med |

---

## 3. Recommended next-step priority

### P0 — GA blockers (not ADRs, but they gate launch)
From `docs/launch-readiness.md`: **P0-5** (realtime/feed are in-memory only, no
cluster coordination) and **P1-2** (execution logs / job runs / event log grow
unbounded). Decide single-instance vs HA and land retention/coordination
**before** any new feature ADR. These outrank everything below for GA.

### P1 — Complete the distribution loop: `0025 install` + `0027 lifecycle`
Recent momentum is almost entirely in distribution (package-install command,
local-manifest-source, marketplace-nav, cloud-connection). The build/publish half
already shipped; the install / registry / promotion half is the natural join, and
it is the keystone that unblocks **0026** and subsumes **0016**'s deferred cloud
publish. Highest value-to-effort coherent line.

### P1.5 — Distribution safety prerequisites
- **0029 K4** finish (small): drop the empty re-export barrels so the
  plugin-owned architecture is clean before third-party packages arrive.
- **0028 namespace isolation** (large): its hard prerequisite (0029) is now
  largely satisfied, so it is **no longer blocked**. Needed before opening up
  multi-package third-party co-install, otherwise silent table-name collisions.

### P2 — Outward differentiator: `0013 Slack bidirectional messaging`
The only one of the five integration ADRs with essentially zero code, and the
only outward-facing headline gap ("operate ObjectStack from Slack"). ADR-0022
already routes the human-notification story into it. Promote to P1 if
conversational Slack is a near-term product goal.

### P3 — Cheap, high-leverage fill-ins (interleave)
- **0046 package docs** (S) — directly feeds AI grounding.
- **0010 L4 + unlock escape hatch** (M) — without it a lock can never be lifted.
- **0017 view RLS backend** + **0040 tool-scoping enforcement** — both are
  security-shaped (today: client-enforced / advisory); worth elevating near GA.

### P4 — Explicitly deferred
0039 Track B (token-tree rewrite, demand-gated), 0031 BPMN XML plugin, 0026
(waits on 0025), 0010-nl-to-flow (high "wow" but pure net-new — after the
distribution loop).

---

## 4. Status-header corrections to apply

These ADR headers should be updated to reflect shipped reality (framework side).
Listed here rather than edited in place, since changing an ADR's recorded status
is a governance act best ratified deliberately.

| ADR | Current header | Suggested |
|---|---|---|
| 0007 | Draft | Accepted — backend implemented; UI pending (objectui) |
| 0032 | Proposed | Accepted — implemented (designer pending, objectui) |
| 0034 | Proposed | Accepted — implemented (v8.0.0) |
| 0041 | Proposed | Accepted — Tier 1 implemented |
| 0042 | Proposed | Accepted — implemented |
| 0043 | Proposed | Accepted — implemented |
| 0044 | Proposed | Accepted — engine + model implemented (designer pending) |
| 0015 | Proposed | Accepted — backend/REST/CLI implemented (UI + drivers pending) |
| 0023 | Proposed | Accepted — library implemented (CLI/examples pending) |
| 0024 | Proposed | Accepted — library implemented (examples pending) |
| 0036 | Proposed | Accepted — framework implemented (cloud surfacing pending) |
| 0039 | Proposed | Accepted — Track A implemented; Track B deferred |
| 0029 | Proposed | Accepted — K0/K1/K2/D7 implemented; K3/K4 remaining |

---

_Generated from a five-cluster ADR sweep; file/commit evidence captured in the
review session. Treat this as a planning input, not a frozen contract._
