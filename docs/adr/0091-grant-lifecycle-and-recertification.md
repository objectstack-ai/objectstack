# ADR-0091: Grant lifecycle — effective-dated assignments, delegation, break-glass, recertification substrate

- **Status:** Proposed
- **Date:** 2026-07-09
- **Deciders:** (pending review)
- **Relates to:** ADR-0090 (Permission Model v2 — named follow-up #1), ADR-0057 (assignment tables), ADR-0049 (no unenforced security properties), ADR-0016 (open-core boundary)

## TL;DR

Every grant today is **permanent** — a `sys_user_position` / `sys_user_permission_set`
row grants until someone remembers to delete it. This ADR makes time a first-class
axis of authorization:

- **D1** — effective-dating columns (`valid_from` / `valid_until`) on the two
  user-grant tables; null = unbounded (existing rows unchanged).
- **D2** — correctness lives in **resolution-time filtering**, not cleanup jobs:
  an expired row simply stops resolving, fail-closed, in every resolver.
- **D3** — delegation of duty (职务代理) = a self-service, time-boxed assignment
  of one's own `delegatable` position, dual-audited.
- **D4** — break-glass = pre-authorized emergency set, self-activated with a
  mandatory reason into a short time-boxed grant, loudly audited.
- **D5** — recertification (定期复核) gets its **substrate** here (certification
  stamps + the D6 explain/matrix APIs); the campaign workflow is an enterprise
  product (cloud repo).
- **D6** — grants to **agent** principals must be time-boxed and task-attributed
  (the ADR-0090 D10 hookup).
- **D7** — open-core line: spec shapes + filtering correctness are community;
  delegation UX, break-glass workflow, campaigns, notifications are enterprise.

## Context

Three converging pressures, none solvable by discipline alone:

1. **The #1 audit finding class.** Contractor access outliving the contract,
   transferred employees keeping old-department grants, "temporary" admin never
   revoked. With permanent-only rows, revocation depends on a human remembering.
   SOX / 等保 / ISO 27001 audits ask both "who can do X" (answered by ADR-0090
   D6 explain/matrix) and "**why do they still have it**" — which needs time and
   attestation on the grant itself.
2. **Legitimate temporary authority is common, not exceptional.** Vacation
   stand-ins for approvers, project-scoped consultants, emergency production
   access. Without a native mechanism, orgs grant permanent power and hope —
   the exact anti-pattern ADR-0090 removed everywhere else.
3. **Agent grants must not be permanent** (ADR-0090 D10). "An assistant
   authorized for THIS task, until THIS deadline" needs `valid_until` and task
   attribution as data, not convention.

Prior art: share links already carry `expires_at` validated at access time
(`plugin-sharing/share-link-service.ts`) — the platform's established expiry
pattern is *resolution-time checking*, not background deletion. Dataverse/
Salesforce ship permission-set-assignment expiry; SAP/NetSuite ship substitution
(delegation) as a core ERP affordance; every IGA product (SailPoint, Saviynt)
sells recertification campaigns on top of exactly this substrate.

## Decisions

### D1 — Effective-dating on user-grant rows

`sys_user_position` and `sys_user_permission_set` gain two nullable columns:

| Column | Semantics |
|---|---|
| `valid_from` | Grant is inactive before this instant. Null = active immediately. |
| `valid_until` | Grant is inactive **at and after** this instant (half-open `[from, until)`, UTC). Null = never expires. |

Plus lifecycle-audit columns shared by D3/D4/D5: `reason` (free text, required
for delegation/break-glass rows), `delegated_from` (user id, D3),
`last_certified_at` / `certified_by` (D5).

Deliberately **not** effective-dated: `sys_position_permission_set` (bindings
compose capability — a binding that flips on a date is a scheduled *publish*,
which belongs to the D7 human-gated publish track, not to per-person grants)
and `sys_record_share` (time-boxed record access is what share links already
do). Existing rows carry nulls — zero migration.

### D2 — Correctness = resolution-time filtering, fail-closed

A grant row outside its validity window **does not resolve**, everywhere,
symmetrically:

- `@objectstack/core` `resolveAuthzContext` (positions + direct sets),
- the explain engine's `buildContextForUser`,
- `plugin-sharing` `PositionGraphService.expandPositionUsers` (sharing-rule
  recipients stop including expired holders),
- the D12 delegated-admin gate's held-scope resolution (an expired
  `sub_admin` grant is an expired admin).

Filtering predicate: `(valid_from is null or valid_from <= now) and
(valid_until is null or valid_until > now)`. Per ADR-0049, **no background job
is required for correctness** — a cleanup/notification job is hygiene and
lands enterprise-side (D7). Clock source is the database `now()` per query;
sub-minute skew is acceptable for this class. The explain engine reports an
expired-but-present row as a dedicated contributor state ("held until
2026-08-01 — expired"), so "why did access disappear" is self-answering.

### D3 — Delegation of duty (职务代理)

A user may delegate a position they hold **without being an admin**, iff:

1. the position definition opts in: `delegatable: true` (PositionSchema;
   default false — approval-duty positions opt in, admin-ish ones do not);
2. the delegation is a new `sys_user_position` row for the delegate with
   `delegated_from = <delegator>`, **mandatory `valid_until`** (config ceiling,
   default 30 days), mandatory `reason`;
3. the delegator **currently holds** that position (validity-filtered) —
   checked by the same gate that owns assignment writes (D12 gate grows a
   self-service branch: delegator ≠ admin, but the write is scoped to
   positions they hold + delegatable + time-boxed);
4. chains are cut: a row with `delegated_from` set is **not itself
   delegatable** (no re-delegation);
5. dual audit: the row carries both `granted_by` (writer) and
   `delegated_from` (authority source); explain reports "via delegation from
   张三, until …".

The delegate acts with the position's own authority (union with their own
grants) — substitution semantics, matching SAP/NetSuite; the intersection rule
stays exclusive to AI agents (ADR-0090 D10), where the risk model differs.

### D4 — Break-glass (应急提权)

An emergency capability is **pre-authorized but dormant**: an env-authored
permission set (e.g. `prod_incident_access`) listed in a tenant-level
`breakGlass` config naming who may self-activate it. Activation inserts an
ordinary `sys_user_permission_set` row with mandatory `reason`, a **short**
`valid_until` (config, default 4h), and an audit event that alerts (loud by
design). No approval loop — break-glass that waits for an approver isn't
break-glass; the compensating controls are the time box, the alert, and D5
review of every activation. Deactivation = the window closing (D2) or early
revocation. The activation endpoint/workflow is enterprise (D7); the *shape*
(a time-boxed direct grant with reason) is just D1 — community deployments can
break glass manually with the same auditability.

### D5 — Recertification substrate (定期复核)

Framework ships the **substrate**, cloud ships the **campaign**:

- substrate = D1's `last_certified_at` / `certified_by` stamps + the ADR-0090
  D6 surfaces (access matrix for "what does this population hold", explain for
  "why", D12 scopes for "who reviews which subtree");
- a certification is an attestation UPDATE on the grant row (stamps only),
  flowing through the D12 gate (a delegate certifies only inside their
  subtree);
- campaign mechanics — schedules, reviewer routing, escalation, auto-suspend
  of grants past `review_due`, evidence export — are enterprise product
  (cloud repo design doc), consuming only public substrate.

### D6 — Agent grants are task-scoped and time-boxed (D10 hookup)

Contract: any grant whose grantee is an **agent** principal MUST carry
`valid_until` and a task attribution (`reason` carries the run/task id until a
dedicated column proves necessary). Enforcement point: the D12 gate, once
agent seats are identifiable on `sys_user` rows (the known P4 deferral —
principal-linked user rows). Until then this is authoring guidance + a D7
linter warning on agent-seat naming conventions; it is recorded here so the
column semantics don't get designed twice.

### D7 — Open-core line (per the edition-tiering review)

| Community (framework) | Enterprise (cloud) |
|---|---|
| Spec columns + zod shapes; resolution-time filtering in every resolver (correctness); explain reporting of validity/delegation; `delegatable` flag + delegation gate rule; manual break-glass with full audit | Delegation self-service UX; break-glass activation workflow + alerting; expiry notifications and cleanup hygiene jobs; recertification campaigns (routing, escalation, auto-suspend, evidence export) |

Security correctness is never paywalled (an expired grant stops working in
every edition); *convenience and compliance workflow* are the product.

## Consequences

- Grant rows become the single source of truth for **when** as well as
  **who/what** — no parallel "temporary access" side-tables.
- Explain/audit answers gain a time dimension for free (D2's contributor
  states).
- The D12 gate grows two small branches (self-delegation, certification
  stamps) rather than new enforcement machinery.
- New D7 lint rules: `valid_until` in the past at authoring time (error);
  delegation rows missing `reason` (error — also runtime-rejected).
- Liveness ledger: new PermissionSet/assignment properties enter as
  `authorable` and flip to `live` with the resolver-filtering PR.

## Non-goals

- **Scheduled binding changes** (`sys_position_permission_set` dating) — a
  future publish-track feature, not a grant feature.
- **Manual-share expiry** — share links already cover time-boxed record
  access.
- **SoD conflict rules** — next ADR (0092 candidate); its exemption records
  will reuse D1's dating + D5's attestation stamps.
- **Approval-gated activation** — break-glass is deliberately unapproved;
  request-approval flows belong to the existing approvals plugin composed at
  the product layer.

## Phasing

1. **L1 (spec + filtering)** — columns, zod shapes, resolver filtering + tests
   (incl. explain states), liveness entries, lint rules. Community-complete.
2. **L2 (delegation + break-glass shape)** — `delegatable` flag, D12 gate
   branches, dual audit, dogfood proof (delegate approves during vacation
   window; access dies at `valid_until`).
3. **L3 (enterprise)** — cloud-side campaign/notification/activation product
   design doc, consuming L1/L2 substrate only.

## References

- ADR-0090 §Non-goals #1 (this ADR); ADR-0090 D6/D10/D12
- `plugin-sharing/share-link-service.ts` — the `expires_at` resolution-time precedent
- Industry: Salesforce permission-set assignment expiry; SAP substitution; Dataverse role-assignment lifecycle; SailPoint/Saviynt certification campaigns
