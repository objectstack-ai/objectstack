# ADR-0052: Audit is not the activity feed — decompose collaboration, activity, and audit into bounded contexts

**Status**: Proposed (2026-06-16) — partially implemented (2026-07-16 audit): §5b declarative activity (`trackHistory` + milestone templates), ActivityPointer fields, and `service-feed` retirement are done; the headline bounded-context decomposition is NOT — `sys_activity`/`sys_comment` still live in plugin-audit, the audit-writer still dual-writes (no event-bus spine), `sys_notification` move deferred (P1/P2).
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0030](./0030-notification-platform-convergence.md) (single-ingress `NotificationService.emit` — *no producer writes a per-user inbox row directly*; this ADR applies the same "one canonical service per context, producers emit through a seam" posture to activity and collaboration), [ADR-0012](./0012-notification-platform.md) (messaging outbox owns `sys_notification`), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-remove posture for governed properties — audit immutability must be enforced at its own boundary, not diluted by co-tenant objects), [ADR-0042](./0042-approval-sla-escalation.md) (uses `sys_audit_log` rows as an idempotency primitive — a second reason audit must stay a clean, append-only ledger)
**Consumers**: `@objectstack/plugin-audit` (sheds 4 of its 5 objects; keeps only `sys_audit_log`), `@objectstack/service-feed` (becomes the canonical collaboration+timeline backend, or is retired into it), `@objectstack/service-storage` (takes `sys_attachment`), `@objectstack/service-messaging` (takes `sys_notification`, per ADR-0030), `@objectstack/platform-objects` (object ownership map), `@objectstack/cli` (`ALWAYS_ON_CAPABILITIES` / capability resolver), `@objectstack/console` (ChatterPanel data source), `@objectstack/spec` (`IFeedService` / event contracts)
**Pilot**: `hotcrm` (its record pages already declare `feeds: true` + `record:chatter`, and its weak CRM activity timeline is the symptom this ADR fixes)

---

## TL;DR

`@objectstack/plugin-audit` has accreted into a god-plugin. A package whose
README promises *"Immutable Logs — audit records cannot be modified or deleted"*
and *"SOC 2, HIPAA, GDPR"* currently **registers five objects across five
bounded contexts**:

```ts
// packages/plugins/plugin-audit/src/audit-plugin.ts:40
objects: [SysAuditLog, SysActivity, SysComment, SysAttachment, SysNotification]
```

Two of those (`sys_attachment`, `sys_notification`) are **already documented in
the same file as belonging elsewhere** (storage, messaging). The other two
(`sys_activity`, `sys_comment`) are an *activity feed* and a *collaboration
surface* — neither of which is audit, and both of which have lifecycle and
governance requirements that directly contradict audit's.

Separately, `@objectstack/service-feed` is a **second, parallel implementation**
of comments + reactions + timeline + subscriptions that the console UI does not
consume — a split-brain.

This ADR rules:

1. **Audit is a ledger, not a feed.** `plugin-audit` keeps **only**
   `sys_audit_log` (immutable, append-only, retained, security-gated).
2. **Activity is a projection, not a side-effect of the audit writer.** The
   activity timeline is fed by a **domain event stream**, not by piggy-backing
   on the audit `afterInsert/Update/Delete` hooks. This is what lets *business*
   events (email sent, call logged, stage advanced) enter the timeline — the
   thing CRM apps actually need.
3. **Collaboration is its own context.** Comments / reactions / @mentions /
   threads are mutable, deletable, GDPR-erasable user content — the opposite of
   an audit row. There must be **exactly one** backend for it; today there are
   two (`sys_comment` and `service-feed`). Pick one and converge (§5).
4. **Misfiled objects go home.** `sys_attachment` → `service-storage`,
   `sys_notification` → `service-messaging` (already converged at the producer
   seam by ADR-0030; finish the ownership move).
5. **"Collaboration / activity is a platform primitive" becomes an explicit
   decision**, not an accident of `plugin-audit` being default-loaded.
6. **The platform generates activity declaratively; apps do not hand-code it.**
   Today the auto-writer emits only flat `"Updated crm_opportunity"` rows, so
   every app must hand-write hooks/flows to get meaningful timeline entries
   ("Stage advanced to Negotiation", "Deal won — …"). That is a per-app
   re-implementation of something the platform already has the data for. A
   declarative **field-level tracking flag** + **object-level milestone
   templates** move that into metadata (§5b) — the same posture as Salesforce
   Feed Tracking, ServiceNow field auditing, and Dataverse column auditing.

---

## 1. Context — how we got here

The audit writer must hook **every** data mutation to write a compliance row.
Because that machinery was already there and `plugin-audit` was already
default-loaded, it became the path of least resistance for anything
"record-attached and cross-cutting":

- **Dual-write on every mutation.** `installAuditWriters` registers one writer
  on `afterInsert/afterUpdate/afterDelete` that writes **both** a compliance row
  and a denormalized activity row:

  ```ts
  // packages/plugins/plugin-audit/src/audit-writers.ts:328-329
  await sys.object('sys_audit_log').create(auditRow);
  await sys.object('sys_activity').create(activityRow);
  ```

  The two objects are 80% the same event at different fidelities —
  `sys_audit_log` is *"immutable, compliance-grade"*, `sys_activity` is
  *"denormalized, human-readable summaries shown [in the UI]"*
  (`audit-writers.ts:43-45`).

- **Homeless objects parked in the audit manifest.** `sys_comment` is *defined*
  by `plugin-audit` but **written by the UI directly** (the audit writer never
  touches it) — it is here only because there was no collaboration service when
  it was authored. `sys_attachment` and `sys_notification` are parked the same
  way, and the code **says so**:

  ```ts
  // packages/plugins/plugin-audit/src/audit-plugin.ts:6-11
  // Registered here but still owned by platform-objects (the plugin contributes
  //   - sys_attachment    — a file↔record link belonging with service-storage's …
  //   - sys_notification  — … belonging with messaging
  ```

- **Default-loaded through the wrong door.** `plugin-audit` runs even when an
  app never declares `audit` (verified: HotCRM lists neither `audit` nor `feed`
  in `requires`, yet `AuditPlugin` boots and `sys_comment`/`sys_activity`/
  `sys_audit_log` all serve `200`). So the console's "always-on collaboration"
  is a side effect of audit being default-on — an implicit, fragile dependency.

- **Runtime cross-context coupling.** The same writer lazily resolves the
  messaging service to emit collaboration notifications
  (`audit-plugin.ts:96-99`), and a regression test exists specifically to stop
  the audit writer from auditing its own writes
  (`audit-writers.test.ts:9`) — evidence the coupling already bites.

## 2. The design flaws (what we are correcting)

| # | Flaw | Why it is wrong long-term |
|---|------|---------------------------|
| 1 | **God-plugin / low cohesion** — one plugin owns 5 objects across audit, activity, collaboration, files, notifications. | A package's identity (immutable compliance) is contradicted by its contents (mutable social comments, file links). Nothing can reason about `plugin-audit`'s guarantees. |
| 2 | **Immutability vs mutability collision** — audit is append-only/retained/non-deletable; comments must be editable/deletable/GDPR-erasable; activity is a prunable projection. | Three incompatible data-lifecycle + governance policies share one boundary. A GDPR erasure of a comment and the "audit cannot be deleted" guarantee cannot both be honored inside one plugin. |
| 3 | **Capability bound to a side-effect writer** — the activity feed is a by-product of audit hooks, so its content can only be generic `created/updated/deleted` CRUD. | Business-meaningful events (email sent, call logged, stage advanced *with context*) can never enter the timeline. This is the root cause of the weak CRM activity timeline. |
| 4 | **Split-brain with `service-feed`** — two implementations of comments+reactions+timeline+subscriptions. | Two sources of truth for "the comments on a record" and "the activity of a record." UI uses one (DB-backed `sys_comment`), the "better-designed" one (`feed_item`, in-memory, nested REST unmounted) is unused. |
| 5 | **Implicit default-load coupling** — collaboration exists only because audit is default-on. | Turning audit off silently removes the comment box. The dependency is undeclared and unowned. |
| 6 | **Runtime tangle** — audit ↔ activity ↔ collaboration ↔ messaging interleaved in one writer. | Ordering bugs, self-audit loops, and the inability to evolve one context without risking the others. |

## 3. Decision — bounded contexts on a domain event spine

Each context becomes a first-class platform primitive with **its own object(s),
lifecycle, and governance**. A **domain event bus** is the spine; audit and
activity are both *projections* of it, not each other's side effects.

```
            ┌──────────────────── Domain Event Bus ────────────────────┐
            │  engine CRUD events  +  app-emitted business events       │
            │  (email.sent, call.logged, opportunity.stage_changed, …)  │
            └───┬──────────────────┬───────────────────┬───────────────┘
                ▼                  ▼                   ▼
        ① Audit (compliance)  ② Activity / Feed    ③ Collaboration
        sys_audit_log         (UX projection,      comments / reactions
        immutable·append-     unified typed        / @mentions / threads
        only·retained·gated   timeline·prunable)   mutable·deletable·GDPR
```

**Ownership after this ADR:**

| Object | Today | After | Rationale |
|--------|-------|-------|-----------|
| `sys_audit_log` | plugin-audit | **plugin-audit** (unchanged) | The one thing audit should own. Stays immutable/append-only/retained. |
| `sys_activity` | plugin-audit | **feed/activity service** | A projection over the event bus, not an audit-writer side effect. |
| `sys_comment` | plugin-audit (defined only) | **collaboration/feed service** | Mutable user content; converge with `service-feed` (§5). |
| `sys_attachment` | plugin-audit (parked) | **service-storage** | Already acknowledged in code. |
| `sys_notification` | plugin-audit (parked) | **service-messaging** | Already converged at the producer seam (ADR-0030); finish ownership. |

**The activity writer moves off the audit hooks.** Today's
`afterInsert/Update/Delete` writer keeps writing **only** `sys_audit_log`. A
separate subscriber on the event bus writes `sys_activity` and can also receive
**business events** that apps emit explicitly (the email/call/stage events a CRM
needs). Audit no longer dual-writes.

## 4. Audit stays pure (and is legitimately ALWAYS_ON)

`sys_audit_log` is the only object whose contract is *governance*: every field
`readonly: true`, `managedBy: 'append-only'`
(`sys-audit-log.object.ts:22`), retention policy, security-gated read. Per
ADR-0049 (enforce-or-remove), those properties must be enforced at audit's own
boundary — which is only possible once mutable co-tenants (`sys_comment`) leave.
Audit **remains a default platform capability**: compliance is foundational,
durable, and HA-safe. It just stops being the dumping ground.

## 5. Collaboration / activity: one backend — **DECIDED: `sys_comment`**

There were two implementations; we converge to one. **Decision: `sys_comment` /
`sys_activity` is canonical; `@objectstack/service-feed` is retired.**

The originally-recommended target was `service-feed`'s single unified *typed*
timeline. But weighing it against the implementation reality reversed that lean:

| | `sys_comment` / `sys_activity` (chosen) | `service-feed` (retired) |
|---|---|---|
| Durability | ✅ DB-backed | ❌ in-memory only ("v1: single-instance; data lost on restart") |
| Default-loaded | ✅ (via audit slate) | ❌ opt-in capability |
| UI consumes it | ✅ ChatterPanel reads/writes it | ❌ never consumed (enabling `feed` was a verified no-op) |
| REST | ✅ generic data API | ❌ nested `/data/{obj}/{id}/feed` route unmounted (404) |
| threads/mentions/reactions | ✅ fields already declared (`parent_id`, `reply_count`, `mentions`, `reactions`) | ✅ (but unreachable) |

Picking the durable, default, UI-wired system reaches "one backend" **now**, at
near-zero risk. `service-feed`'s only real edge — one unified *typed* stream — is
obtained on the chosen family by treating **`sys_activity` as the unified
timeline base** — the **ActivityPointer** model (cf. Dataverse `ActivityPointer`
→ `Email`/`PhoneCall`/`Appointment` subtypes; Salesforce ActivityTimeline →
`EmailMessage`/`Task`/`Event`):

- **`type` stays domain-NEUTRAL** — the platform-produced verbs (`created`,
  `updated`, `commented`, `completed`, …). It is **not** extended with one
  vertical's vocabulary (`email`/`call`/`meeting`); every domain has its own
  (`interview`, `site_visit`, `inspection`, …) and a closed enum would be an
  endless treadmill. Domain kind rides in `metadata.kind`.
- **Rich communication entities are their own tables** — an email belongs in
  `sys_email` (already exists), a call/meeting in a task/activity object — never
  crammed into a generic activity blob (they have structured headers, threading,
  attachments, mutable delivery status that must be queryable).
- **`sys_activity` carries a structured pointer to that source entity** via
  `source_object` / `source_id` (added in this PR) — distinct from
  `object_name`/`record_id` (the *regarding* record). The timeline drills from a
  one-line summary to the full email/call record, and apps can query "all
  activities sourced from `sys_email`". This is the queryable equivalent of an id
  buried in `metadata`.

The two remaining UI niceties (reactions, threaded replies) are a render of
fields `sys_comment` **already** has — an objectui enhancement, not a backend
change.

Rejected alternative — invest in `service-feed`: building a DB adapter + mounting
the REST route + repointing ChatterPanel + migrating `sys_comment` rows is weeks
of cross-repo work to **duplicate a system that already works durably**. That is
the split-brain this ADR exists to end, not extend.

> Superseded note (kept for history): an earlier draft deferred this to a build
> spec and leaned toward `service-feed`. Implementation reality (in-memory,
> UI-unused, REST-unmounted) decided it the other way.

The terminal state is **one backend, not two** — now realized: `service-feed`'s
runtime (the package + the `feed` capability) is removed; `sys_comment` /
`sys_activity` stand alone. (The vestigial spec *contracts* — `feed.zod` /
`feed-api.zod` / `IFeedService` — are a separate type-surface cleanup, since they
are woven into `component.zod` / `protocol.zod` / objectql; tracked as follow-up.)

## 5b. Declarative activity — the platform generates it, apps don't code it

This is the highest-leverage item for a low-code platform, and the one app
authors feel daily. Today, to get a meaningful timeline an app must hand-write
imperative `*.hook.ts` / `*.flow.ts` that `insert` `sys_activity` rows — and
**every** metadata app re-implements the same wheel. That is backwards: the
platform already has what it needs.

### The gap, in the code

The auto-writer (`audit-writers.ts`) runs on every mutation and **already
computes the field-level diff** (`diff(before, after)` → stored verbatim in the
activity row's `metadata: {old, new}`). It then throws that structure away at
render time and emits a flat, useless summary:

```ts
// packages/plugins/plugin-audit/src/audit-writers.ts
const summary = action === 'update' ? `Updated ${ctx.object} "${label}"` : …;
```

So the platform has `stage: "proposal" → "closed_won"` in hand and renders
*"Updated crm_opportunity"*. The information loss is at the **render** step, not
the capture step. Separately, the field schema once had an `auditTrail` flag; it
was pruned 2026-06 as *"aspirational governance with no runtime consumer"*
(field.zod.ts, this branch). That prune was correct **as an enforce-or-remove
call (ADR-0049)** — a declarative flag that drives nothing is dead surface. The
fix is not "don't have the flag"; it is **have the flag and wire it to
behavior.**

### Prior art — every mainstream low-code platform does this declaratively

| Platform | Mechanism | Author effort |
|---|---|---|
| **Salesforce** | **Feed Tracking** (per-object, mark ≤20 fields) → Chatter auto-posts *"changed Stage from Proposal to Closed Won"*; **Field History Tracking** → `<Object>History` rows | a checkbox per field — **zero code** |
| **ServiceNow** | Dictionary **Audit** attribute per field + **Activity Formatter** (admin picks which fields appear in the activity stream) | config — **zero code** |
| **Microsoft Dataverse** | per-table / **per-column Auditing**; **Timeline** control auto-aggregates activities | config — **zero code** |
| **Salesforce / Power Automate** | **Flow** for *semantic / milestone* events that aren't a raw field change | declarative flow, not code |

The consistent pattern: **declarative, per-field opt-in → the platform
auto-generates the human-readable change entry.** Imperative code is reserved
for genuinely semantic events that a field diff can't express.

### Decision — three declarative tiers (most value at the top)

1. **Field-level `trackHistory` (P0, this ADR implements it).** A boolean on the
   field schema. When a tracked field changes, the activity writer renders the
   diff it *already has* as a human-readable summary — `"Stage: Proposal →
   Closed Won"`, using the field label and (for selects) the option labels —
   instead of `"Updated …"`. This alone deletes ~80% of the hand-coded
   stage/status/priority activity in HotCRM (see [hotcrm#396]) and gives **every
   future app** the same for free. Opt-in (like Feed Tracking) keeps the stream
   from becoming change-noise. Enforce-or-remove (ADR-0049) is satisfied: the
   flag now has a runtime consumer.

2. **Object-level milestone templates (P1, declarative).** For semantic events a
   raw diff can't name — *"Deal won — {name} ({amount})"* when `stage` enters
   `closed_won`, *"Case resolved — {subject}"* when `status` enters `resolved`.
   Expressed as metadata on the object (a condition → templated summary),
   evaluated by the activity engine. **No `*.hook.ts`.** This is where the
   HotCRM `opportunityActivityHook` / case wiring should *move to and disappear*.

3. **Action / communication events → event bus → projection (P2).** Emails,
   calls, meetings are not field changes; an action/flow should `emit` a typed
   domain event that the activity service projects, rather than an action body
   hand-`insert`ing `sys_activity` (as HotCRM's `send_email` / `log_meeting` do
   today). Same spine as §3.

### Consequence for business apps

The end state is that a CRM **declares** its timeline (`trackHistory: true` on
`stage`/`status`/`priority`; a handful of milestone templates) and writes **no**
activity code. The hand-coded hooks/actions shipped in [hotcrm#396] become the
*reference for what the declarative layer must subsume*, then are deleted. "Why
isn't this auto-generated?" stops being a fair question.

## 6. Rollout

Sequenced **platform-first**: each platform tier lands before the business apps
that consume it, so app code is *deleted against* a working declarative layer
rather than written twice.

- **P0a — declarative field-change activity (§5b.1).** Add the `trackHistory`
  field flag to the spec and wire `audit-writers` to render tracked diffs as
  human-readable summaries. Smallest change, biggest daily payoff, no migration —
  it only improves the *render* of rows the writer already emits. **This ADR
  ships P0a.**
- **P0b — ownership, no behavior change.** ✅ `sys_attachment` registration moved
  `plugin-audit` → `service-storage` (both always-on, so it stays available; the
  definition stays in `platform-objects`). `sys_notification` is **deferred** — it
  is mid-migration to an event model (`metadata/.../migrate-sys-notification-to-event.ts`,
  ADR-0030), so moving it now would collide with that in-flight work. Still TODO:
  make "collaboration/activity is a platform primitive" an explicit capability
  rather than an audit side-effect; keep it default-available so no UI regresses.
- **P1 — kill the split-brain + milestone templates (§5b.2).** Choose the
  canonical collaboration backend (§5), migrate/alias `sys_comment`, repoint
  ChatterPanel, surface reactions/threads. Add declarative object-level milestone
  templates. **Then** retire the HotCRM `opportunityActivityHook` / case wiring
  into declarations.
- **P2 — event spine (§5b.3).** Introduce the domain event bus; move
  `sys_activity` to a projection subscriber; let apps `emit` business events
  (including email/call/meeting, retiring the hand-`insert` in HotCRM actions);
  strip the activity write out of `audit-writers`. Audit becomes a pure ledger.

## 7. Consequences

- **Positive.** Audit can finally honor its README (immutable, GDPR-compatible,
  because erasable user content lives elsewhere). The activity timeline gains
  business events. One collaboration source of truth. Disabling audit no longer
  removes the comment box. Each context evolves independently.
- **Cost.** A data migration for `sys_comment`/`sys_activity` ownership; a
  durable feed adapter; ChatterPanel rework in objectui; a new event-bus seam.
  Sequenced P0→P2 so each step is independently shippable and back-compatible.
- **Back-compat.** Object **names** (`sys_comment`, `sys_activity`,
  `sys_audit_log`, `sys_attachment`, `sys_notification`) are preserved across the
  move; only their **owning plugin/service** changes. Existing queries
  (`thread_id`, `record_id` filters) keep working.

## 8. Alternatives considered

- **Leave it.** Rejected: the contradictions (flaws #2/#4) actively block GDPR
  erasure and a real CRM timeline, and the duplication grows.
- **Default-on `feed` now.** Rejected: ships a second, non-durable, UI-unused
  comment store alongside the in-use one — adds split-brain surface with zero
  user-visible benefit (verified empirically: enabling `feed` changed no UI call
  path; ChatterPanel still queried `sys_comment`/`sys_activity`).
- **Fold audit into the feed (one mega-stream).** Rejected: compliance needs an
  *isolated, immutable, separately-retained, separately-access-controlled*
  ledger. Audit is a sink of the event bus, never co-mingled with mutable user
  content.
