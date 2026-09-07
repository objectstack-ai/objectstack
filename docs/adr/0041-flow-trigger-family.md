# ADR-0041: Flow trigger family — taxonomy, naming, and the open-source core set

**Status**: Accepted — Tier 1 implemented (rename deprecation stubs pending) (proposed 2026-06-12 · calibrated 2026-06-12)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0018](./0018-unified-node-action-registry.md) (open node/executor registry — descriptors as the engine-owned contract surface), [ADR-0030](./0030-notification-platform-convergence.md) (outbox-backed delivery), [ADR-0012](./0012-notification-platform.md) (notification platform / messaging)
**Consumers**: `@objectstack/service-automation` (the `FlowTrigger` seam), `@objectstack/cli` (`serve` auto-wiring), runtime presets, Studio flow designer (trigger pickers), future marketplace packaging

---

## TL;DR

A **trigger** is an event-source adapter that wakes the *one* automation
engine: it normalizes an external or internal signal into a flow execution,
via the engine's `FlowTrigger` extension seam. Triggers are how **business
events become user-editable logic** — their downstream is a flow a
non-developer drew in Studio, which is what distinguishes them from the two
other wake-up mechanisms the platform already has (kernel hooks: in-process
lifecycle code; `jobs`: a clock for plugin-owned code).

This ADR decides three things:

1. **Taxonomy & naming** — triggers become a first-class package family
   `trigger-*` (`@objectstack/trigger-schedule`, …), dropping the `plugin-`
   prefix, consistent with the existing `driver-*` / `connector-*` /
   `embedder-*` / `knowledge-*` families.
2. **The open-source core set** — three triggers are *table stakes for every
   project* and ship Apache-2.0 in the default runtime preset:
   `trigger-record-change` (shipped), `trigger-schedule` (shipped), and
   **`trigger-api` (inbound webhook/HTTP — the one gap to build now**; the
   flow schema already reserves `type: 'api'` with no runtime behind it).
3. **Everything else is deliberately deferred** — to an on-demand
   open-source tier or to marketplace distribution — with the criteria for
   promotion written down, so the family grows by demand instead of by
   speculation.

## Context — current state (verified 2026-06-12, against the code)

**The seam exists and two triggers are real.** The engine exposes
`registerTrigger({type, start(binding, cb), stop(flowName)})`
(`service-automation/src/engine.ts`); when a flow is registered/enabled it
parses the start node into a `FlowTriggerBinding`
(`{flowName, object?, event?, condition?, schedule?, config?}`) and hands it
to the trigger registered for that `type`. The CLI's `serve` auto-loads two
concrete triggers (`cli/src/commands/serve.ts`):

- `plugin-trigger-record-change` — data events (`record-after-update`, …).
  Battle-tested: the showcase budget-approval flow runs on it.
- `plugin-trigger-schedule` — bridges the seam to `IJobService`
  (`spec/contracts/job-service.ts`), normalizing authoring shorthands (bare
  cron string, `{every}`, `{at}`) into canonical `JobSchedule`s and managing
  job lifecycle with the flow (`flow-schedule:<flowName>`, cancel on
  disable).

Both follow the same decoupling pattern: structural mirrors of the engine
types (no import of `service-automation`) and structural service surfaces
(no import of the job adapter). Triggers, the engine, and their backing
services version independently; a missing trigger means the flow simply
never activates.

**The declared-but-unwired surface.** The flow schema's type enum is
`'autolaunched' | 'record_change' | 'schedule' | 'screen' | 'api'` — `api`
has **no trigger implementation and no inbound REST route**. This is the
platform's normal contract-first pattern (cf. `recalled` before `recall()`,
`ApprovalEscalationSchema` before any scheduler), but it is also a Studio
trap: the designer renders from engine descriptors, and a user can author an
`api` flow that will never run.

**Naming is inconsistent.** `packages/plugins/` already contains four
families named by *capability domain* rather than by *loading mechanism*
(`driver-*`, `connector-*`, `embedder-*`, `knowledge-*`); the two triggers
are the outliers carrying a `plugin-` prefix.

## Decision

### 1. What is (and is not) a trigger

A trigger adapts **one class of business event** into flow executions. The
test for "should X be a trigger": *does this event need a non-developer to
orchestrate the response in Studio?*

Explicit non-goals, recorded to keep the family honest:

- **`screen` flows** are user-*launched*, not event-*triggered* — no trigger.
- **Approval outcomes** continue down the approval node's out-edges — no
  "approval trigger".
- **Plugin-internal clocks** (SLA scanner #1742, cleanup jobs) call
  `IJobService` directly — a trigger's downstream must be a flow, not plugin
  code.

### 2. Naming: the `trigger-*` family

Rename, keeping class names (the `*Plugin` suffix accurately describes the
kernel loading mechanism):

| today | becomes |
|---|---|
| `plugin-trigger-record-change` | `@objectstack/trigger-record-change` |
| `plugin-trigger-schedule` | `@objectstack/trigger-schedule` |

Migration: workspace rename + final `plugin-trigger-*` versions published as
deprecation stubs re-exporting the new packages; `serve` `nameMatch` lists
already match both spellings.

### 3. The tiers

**Tier 1 — core, Apache-2.0, ships in the default runtime preset.**
Every project needs these; they are the Zapier/Power-Automate baseline trio
(*data changed / time passed / someone called us*):

| trigger | status | scope |
|---|---|---|
| `trigger-record-change` | ✅ shipped | data events |
| `trigger-schedule` | ✅ shipped | cron / interval / once |
| `trigger-api` | **build next — the only Tier-1 gap** | inbound webhook/HTTP starts a flow |

`trigger-api` acceptance criteria (the short-term work item):

- Per-flow inbound endpoint (`POST /api/v1/automation/hooks/:flowName/:hookId`)
  with a per-flow secret; HMAC signature verification (GitHub/Stripe style)
  and a constant-time compare.
- Request body → flow variables via the binding's `config` mapping; the
  raw payload available as `$payload`.
- **Queue-backed ingestion from day one**: inbound HTTP is the first trigger
  whose event rate is not under our control. The handler enqueues
  (`service-queue` / outbox per ADR-0030) and ACKs 202; a consumer executes
  the flow. At-least-once delivery; flows must be authored idempotently
  (documented; a `dedupKey` passthrough supported).
- Activates the reserved `type: 'api'` — closing the Studio trap (§4).

**Tier 2 — open source, on demand.** Built when a driving scenario lands,
not before. Each bridges an existing service, so the cost is one adapter:

- `trigger-email-inbound` — email-to-case; needs per-deployment inbound mail
  infra (plugin-email is outbound-only today).
- `trigger-queue` — consume integration events from `service-queue` /
  external brokers; becomes urgent the moment two ObjectStack deployments
  (or an external ESB) need to talk.
- `trigger-lifecycle` — platform events (user created, package installed)
  promoted from kernel hooks to Studio-orchestratable events.

**Tier 3 — marketplace / vertical (future, possibly commercial).**
Naturally per-ecosystem packages, distributed and versioned like connectors:

- `trigger-connector-event` family — third-party SaaS events (Slack message,
  Stripe payment, GitHub PR), one package per ecosystem, pairing with the
  outbound `connector-*` actions (ADR-0022); supports both webhook-subscribe
  and poll modes.
- `trigger-threshold` — metric-crossing alerts on `service-analytics`.
- `trigger-file` — storage-bucket events.
- `trigger-iot` — MQTT/device telemetry (vertical).

**Promotion rule**: a Tier-2/3 trigger moves up when (a) two independent
real projects request it, or (b) it unblocks a Tier-1 acceptance criterion.
Nothing is built speculatively.

### 4. Discoverability: descriptors carry maturity

Triggers self-describe to the engine the way node executors do (ADR-0018):
a descriptor with `type`, display name, config schema for the start-node
form, and a **`maturity: 'ga' | 'beta' | 'reserved'`** field. Studio renders
trigger pickers from the live registry and greys out `reserved` — flow
types whose runtime hasn't shipped (today: `api`) become visible-but-
disabled instead of silent traps. The same audit marks `escalation` and
other contract-ahead-of-runtime surfaces.

### 5. Delivery guarantees, stated per tier

- In-process, low-rate triggers (record-change, schedule, lifecycle):
  direct engine callback, as today.
- Boundary triggers (api, queue, connector-event, email): **must** ingest
  through the outbox/queue path — a slow flow execution may not drop or
  block inbound events. This is decided now so `trigger-api` is built toward
  it rather than retrofitted.

## Consequences

- Two package renames (deprecation stubs, one changeset) — mechanical.
- One real build item short-term: `trigger-api`, including the queue-backed
  ingestion seam it forces us to establish for every future boundary
  trigger.
- Studio gains a registry-driven trigger picker and loses the `api` trap;
  the `maturity` field gives the platform a standing way to ship contracts
  ahead of runtimes without misleading authors.
- The marketplace gets a well-shaped unit of distribution
  (`trigger-<ecosystem>`), aligned with how connectors are already framed.
- Deferred lists are recorded with promotion criteria, so "why don't we
  have an email trigger?" has a written answer instead of a re-litigated
  debate.

## References

- Engine seam: `packages/services/service-automation/src/engine.ts`
  (`FlowTrigger`, `registerTrigger`, `activateFlowTrigger`)
- Shipped triggers: `packages/plugins/plugin-trigger-record-change`,
  `packages/plugins/plugin-trigger-schedule`
- Reserved surface: `FlowSchema.type` enum (`packages/spec/src/automation/flow.zod.ts`)
- Auto-wiring: `packages/cli/src/commands/serve.ts` (trigger `nameMatch` table)
- Related: ADR-0018 (descriptor pattern this extends), ADR-0030 (outbox),
  approvals SLA scanner issue #1742 (the "jobs, not trigger" precedent)
