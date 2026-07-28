# ADR-0073: Automation execution identity — a built-in non-human principal for user-less runs, `runAs` as authorization posture, attribution always concrete

**Status**: Proposed (2026-06-25)
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0002](./0002-environment-database-isolation.md) (**environment-per-database** isolation; Control-Plane / Data-Plane split), [ADR-0004](./0004-cloud-multi-kernel.md) (`ObjectKernel` per environment), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce-or-mark gate; stage by whether the feature exists), [ADR-0057](./0057-erp-authorization-core-business-units-and-scope-depth.md) (`sys_role` is platform-native; `ExecutionContext.roles`; scheduled/lifecycle jobs), [ADR-0066](./0066-unified-authorization-model.md) (capability / assignment / requirement separation — resources declare a capability, never "who"), [ADR-0068](./0068-unified-user-context-and-built-in-identity-roles.md) (`EvalUser` / `current_user`; **identities are roles, not booleans**)
**Consumers**: `@objectstack/spec` (the identity contract + `runAs` semantics), `@objectstack/cli` (author-time validation), `@objectstack/plugin-security` (`resolve-execution-context`, RLS, seeded roles — M2), `@objectstack/service-automation` (the engine's `runAs` resolution — M2), `@objectstack/trigger-schedule` + `@objectstack/trigger-api` (user-less trigger surfaces), `@objectstack/plugin-reports` (the report scheduler — today hand-rolls `SYSTEM_CTX`), `@objectstack/runtime` (audit actor), and the ADR-0057 lifecycle/retention jobs.

**Premise**: pre-launch — specify the target end-state, then land only the non-speculative slice now (ADR-0049). This ADR **completes** the identity model: ADR-0068 unified the *human* identity surface (`current_user`, identities-as-roles); this ADR adds the **non-human / automation** identity that user-less runs need, in the same idiom. **It is deliberately mostly a decision record**: the acute risk is already mitigated (see Severity), so v1 builds almost nothing — it pins semantics before the AI authors a large body of metadata against the wrong model, and ships one author-time guardrail.

> **Trigger**: #1888 enforced flow `runAs`, and the follow-up #2308 surfaced that a **schedule-triggered** flow with the default `runAs:'user'` has **no trigger user** → the data-layer security middleware *skips* (it skips on no-identity by design, delegating auth to the auth layer) → the run executes **UNSCOPED** (effectively elevated). #2308 made that fail-open *audible* (a build-time lint + a runtime warning, and fixed the example flows) but deliberately did **not** change the runtime identity — because the right fix is a platform-identity decision, recorded here.

---

## Amendment: user-less data ops are now REFUSED (2026-07-28, #3760)

Two load-bearing claims below turned out to be wrong. Both were about *severity*, not about the model — D1–D5 stand unchanged, and D5 shipped in full.

**1. "There is no untrusted-input path to the fail-open" — false.** The Severity section argues the risk is acute-mitigated because schedules are admin/AI-authored and "an unprivileged user cannot trigger a schedule". That is true of schedules and irrelevant to the actual exposure. The fail-open predicate is `runAs !== 'system' && !userId` — *any* run that resolves no user — while the lint only ever covered the schedule shape. The dominant real-world shape is a **record-change flow fired by a write that carried no user**: `isSystem` does **not** suppress trigger dispatch (only `skipTriggers` does, and exactly three first-party paths set it), so every plugin/service system write, the approvals status mirror, and a `runAs:'system'` flow's own data node all dispatch record-change flows with `userId: undefined`. Ordinary users reach those writes routinely — submitting for approval mirrors a status onto the target record. So the fail-open was reachable by unprivileged input, and was the common case rather than the rare one.

**2. "Fail-closed … Rejected in #2308: breaks legitimate scheduled CRUD (2/3 example flows relied on the default)" — expired.** Those example flows were fixed as part of #2308 itself; every first-party schedule-triggered flow now declares `runAs: 'system'`. The stated cost of fail-closed no longer exists.

**Consequently `runAs:'user'` + no trigger user now REFUSES the data operation** (`UnscopedRunDataAccessError`, thrown from `resolveRunDataContext` — the single place every data node resolves its context). This implements D5's ruling ("user-less `runAs:'user'` is a configuration error") at the only layer that can see the record-change case, since whether a triggering write carries a user is not knowable at authoring time.

Note what this deliberately is **not**: it does not re-badge these runs as `isSystem`. The security middleware's `isSystem` short-circuit precedes its package-managed-row / system-row / audience-anchor / delegated-admin gates, all of which a principal-less context still has to clear — so "unscoped" was never equivalent to "system", and elevating would have *widened* these runs (e.g. letting them write `sys_user_position`) rather than preserving the status quo.

This is an **interim** posture, not a replacement for D2. Refusal is strictly safer than today and forward-compatible: when the `automation` principal lands, the refusal point becomes the place that resolves it, and these runs go from *refused* to *RLS-enforced* with no third state. Ordering is unchanged — D2 still waits for a real consumer.

---

## TL;DR

1. **[model] Automation is a first-class non-human identity, expressed as a built-in role** (the ADR-0068 idiom): the **environment's `automation` principal** — a Data-Plane identity living in that environment's own kernel/DB. A user-less run resolves to an `EvalUser` whose `id` is the env's stable automation principal and whose `roles` carry the `automation` role. There is **no anonymous run**. (Cross-environment, platform-wide automation is a **Control-Plane** concern — ADR-0002/0004 — out of scope; see D4.)
2. **[model] `runAs` declares *authorization posture*, not identity** — decoupling the two axes the platform conflates today:
   - `user` — run as the triggering human (only valid when one exists);
   - **`automation`** (the target default for user-less triggers) — run as the automation principal **with RLS enforced** against its grants (Salesforce "with sharing"; the safe middle);
   - `system` — full elevation (`isSystem`, RLS-bypassing) — explicit opt-in, **back-compat unchanged**, always audited.
3. **[model] Attribution is always concrete** — every run carries an identity, so the **audit actor** is the human or the environment's automation principal. **No more `created_by = NULL` automation writes.** Attribution is recorded at the audit layer and is **decoupled from record ownership** (automation must not silently *own* the rows it writes, or owner-RLS would hide them from humans).
4. **[ruled] User-less + `runAs:'user'` is a configuration error** (no user to scope to). Mainstream platforms do not offer "as the triggering user" for scheduled work; neither do we.
5. **[staging — the key call] Build almost nothing now.** v1 = **this decision record + the author-time guardrail** (extend the #2308 lint to every user-less trigger; turn user-less `runAs:'user'` into a validation error). **Everything runtime — seeding the roles, the principal, attribution wiring, the `automation` default — is M2, *gated on the first real consumer*, not a date.** Rationale below.

---

## Context

### The two axes the platform conflates

"What identity does a run execute under when there is no human?" is the classic **confused-deputy** problem. Mature platforms keep two axes separate:

- **Authorization** — what may the run read/write? (RLS / permission context)
- **Attribution** — who is recorded as having done it? (audit identity)

ObjectStack collapses both into "is `context.userId` present?", which is why the user-less case both (a) loses authorization (skips → unscoped) and (b) loses attribution (`created_by = NULL`).

### What the surfaces do today (code-grounded)

| Run | Authorization | Attribution |
|---|---|---|
| `runAs:'user'` (human present) | trigger user + full RLS | `created_by = userId` |
| `runAs:'system'` | `{isSystem:true}` → bypasses **everything** (object perms + RLS) | `created_by = NULL` (orphan) |
| user-less + `user` (schedule/webhook) | **skips** → UNSCOPED (the #2308 fail-open) | `created_by = NULL` (orphan) |

Two findings sharpen the problem:

- **Automation creates orphan records.** `created_by` is stamped from `session.userId` (`@objectstack/objectql` insert hook); a `system`/user-less run has no `userId` → `created_by = NULL`. The existence of `claimSeedOwnership` (re-owning NULL rows to the first admin) is the tell. "NULL-then-claim" works for **one-time seeds** (a single claim event) but **fails for perpetual automation** — a nightly sweep has no claim event, so unattributed rows accumulate forever.
- **The standing system user was deliberately removed.** `SystemUserId.SYSTEM` (`usr_system`) is vestigial ("NO LONGER AUTO-PROVISIONED", `system-names.ts`). That removal was about **seed ownership ergonomics**, not automation — so it does not bar a non-human *execution* identity, but it warns us not to recreate a seed-ownership crutch.

### Severity & current state — why this is mostly a decision record, not a build

This is a **footgun / hardening** issue, not an actively exploited hole, and the acute risk is **already mitigated**:

- ~~Scheduled flows are **admin/AI-authored metadata**; an unprivileged user **cannot trigger a schedule**, so there is no untrusted-input path to the fail-open.~~ **Falsified (#3760)** — see the Amendment. True of schedules, but schedules were never the boundary: a record-change flow fired by a user-less system write hits the identical fail-open, and unprivileged users reach those writes routinely.
- **#2308 already shipped** the cheap mitigations: a build-time lint, a runtime warning, and fixing the example flows to explicit `runAs:'system'`. The bleeding is stopped.
- Tenant isolation is **physical — environment-per-database** (ADR-0002): each tenant environment is its own kernel + DB. So the hard problem (cross-tenant RLS for an automation principal) **does not exist in this architecture** — the automation principal is a purely *intra-environment* Data-Plane identity with no cross-tenant data reach to scope. (The platform is also pre-launch / single-operator.)
- The live automation surface is **tiny**, and — decisively — the existing scheduled flows (`stale_opportunity_sweep`, the app-todo sweeps) all want **full `system` elevation**, not the RLS-respecting middle. **The `automation` mode this ADR introduces has zero consumers in the current app set.**

Building the runtime machinery now would therefore be the speculative enforcement ADR-0049 explicitly warns against. The real, present value is (a) pinning `runAs` semantics + the automation-identity model **before the AI authors metadata at scale**, and (b) the author-time guardrail.

### How mainstream platforms solve it

| Platform | Authorization for automation | Attribution |
|---|---|---|
| **Salesforce** | System Context with author choice: *without sharing* (god-mode) vs **with sharing** (elevated object/FLS, record sharing still enforced). Never "as the triggering user". | dedicated **"Automated Process"** system user. |
| **ServiceNow** | scheduled jobs/flows have a **"Run as"** service account; ACLs evaluated against it. | the service account. |
| **AWS IAM** | per-task **execution role** — a first-class non-human principal, **least-privilege**, assumed per-invocation. | the role, in CloudTrail. |
| **Kubernetes** | every workload (incl. CronJobs) runs under a **ServiceAccount**; RBAC against it. | the ServiceAccount. |
| **iPaaS (Workato/Zapier)** | steps run as the **connection owner** (the configured credential). | the connection. |
| **GitHub Actions** | scoped `GITHUB_TOKEN`; default shifted broad → read-only (least-privilege trend). | the workflow token. |
| **Postgres** | `SECURITY DEFINER` = "run as definer" — documented as a privilege-escalation **footgun**. | the role. |

**Four invariants they converge on**: (1) automation always runs as a **concrete, named, non-human principal** — never "no one", never ambient god-mode; (2) **authorization ≠ attribution**; (3) **safe, explicit defaults**, least-privilege as the trend; (4) **elevation is explicit and audited**. ObjectStack violates (1) and (2) for the user-less case.

This primitive is **not flow-specific**: `plugin-reports` already hand-rolls `SYSTEM_CTX = {isSystem:true}`, audit writes, the ADR-0057 retention/lifecycle jobs, future queue/webhook consumers, and autonomous AI agents all need the same non-human identity. Building it inside the flow engine would be a mistake — it is a **platform identity primitive**, which is why this ADR exists rather than a one-off flow patch.

---

## Decision (the target model)

> D1–D5 describe the **end-state**. What is *built* now vs. deferred is in **Scope**.

### D1 — A non-human automation identity, expressed as built-in roles

Extend ADR-0068's "identities are roles" to the non-human case. A single reserved, managed `sys_role` row per environment (sibling of `platform_admin` / `org_*`), carrying `label` + `description`:

| name | scope | meaning |
|---|---|---|
| `automation` | the environment (its own kernel/DB) | the identity for **app-authored** scheduled / user-less / system-initiated runs **within this environment**. |

Because isolation is **environment-per-database** (ADR-0002, see D4), there is **no in-kernel cross-tenant automation role** — the DB boundary is the tenant boundary. Cross-environment, platform-wide automation (retention across customers, fleet telemetry) is a **Control-Plane** actor (ADR-0002/0004) that iterates over environments; it is *not* an in-kernel `sys_role` and is out of scope here.

A user-less run resolves to an `EvalUser` (ADR-0068) whose `id` is the environment's stable automation principal id and whose `roles` include the `automation` role. It appears as `current_user` like any other identity — so RLS, formulas, and audit treat it uniformly, with **zero bespoke booleans** (ADR-0068 D2). The principal is **non-loginable** and excluded from human/admin enumerations (the existing `usr_system` exclusion guards already model this). This does **not** resurrect `usr_system` as a seed-ownership crutch (seeds keep NULL-then-claim); it adds a non-human **execution + attribution** identity in the modern idiom.

### D2 — `runAs` declares authorization posture, not identity

`runAs` stops meaning "system vs user" (which conflates the two axes) and becomes a declaration of authorization posture, resolved against the run's available identity:

| `runAs` | authorization | when |
|---|---|---|
| `user` | the triggering **human** + full RLS | only valid when a human triggered the run |
| **`automation`** | the **automation principal**, **RLS enforced** against its grants (object perms + record-level RLS both apply) | the **target default for user-less triggers** (schedule, unauthenticated webhook, internal `execute`) |
| `system` | `{isSystem:true}` — full elevation, RLS-bypassing | explicit opt-in; **semantics unchanged from today** (back-compat) |

`automation` is the Salesforce-"with sharing" middle that ObjectStack's binary `system`/`user` cannot express today: elevated enough to act as the platform, but **still subject to row-level security and its own permission grants**. (Note: it has no consumer in the current app set — see Severity — so its *runtime* is M2; the enum value + semantics are reserved now.)

### D3 — Attribution is always concrete, and decoupled from ownership

- Every run carries an identity, so the **audit actor** is always concrete: the human or the environment's `automation` principal. The anonymous/`NULL` automation write is eliminated.
- **Attribution ≠ ownership.** Automation must **not** be force-stamped as `created_by` / `owner_id` of the rows it writes — owner-RLS keys on `created_by == current_user.id` (ADR-0057/0068), so automation-owned rows would become **invisible to the humans they are for**. Salesforce models this exactly: `CreatedBy = Automated Process` (audit) while `OwnerId` is set by flow logic. Therefore: record the automation actor at the **audit layer**; let flow logic set ownership explicitly (or leave the normal default), not the execution identity.

### D4 — Isolation is physical (environment-per-database); the automation principal is per-environment

ObjectStack is **environment-per-database** (ADR-0002): each tenant environment is its own `ObjectKernel` + DB (ADR-0004), with a hard **Control-Plane / Data-Plane** split. This dissolves the multi-tenant scoping question rather than answering it:

- The `automation` principal is a **Data-Plane** identity that lives in the environment's **own** kernel/DB. There is **no cross-tenant data access from inside a tenant kernel** — the database boundary *is* the tenant boundary — so **no "unscoped cross-tenant" automation role is needed** (or wanted).
- Its RLS is therefore purely **intra-environment**: it respects *this environment's* users' ownership/sharing (`runAs:'automation'`) or bypasses them (`runAs:'system'`). The `automation` vs `system` distinction is about the env's own users, never about tenants.
- **Cross-environment / platform-wide automation** (retention across customers, fleet telemetry, migrations) is a **Control-Plane** concern that iterates over environments — each a separate DB — and acts within each via that env's own principal. It is **not** a kernel-resident role with cross-tenant reach, and is **out of scope** for this (Data-Plane) ADR.

### D5 — User-less `runAs:'user'` is a configuration error [enforced in v1]

A scheduled / unauthenticated-webhook trigger has no user; `runAs:'user'` there is incoherent. Validation rejects it (extending the #2308 lint into a hard author-time rule for **all** user-less trigger types). The author picks `automation` (target default) or `system`.

---

## Scope

**v1 — land now (no runtime machinery):**
1. **This decision record** — pins the model (D1–D4) + `runAs` posture semantics, so the AI authors flows against the right target and M2 has a contract. (Cheapest to land pre-scale, exactly the ADR-0068 v1 argument.)
2. **Author-time guardrail (D5)** — extend the #2308 `flow-runas-unscoped` lint to every user-less trigger type (api/webhook/queue), and make user-less `runAs:'user'` a **validation error** at compile. Small, non-breaking, and the real present value: it stops the AI from generating the wrong pattern before there is a large body of it.

Runtime behavior is otherwise **unchanged** from #2308 (the audible warning stays). **We do not seed the roles, mint the principal, or touch `runAs` resolution in v1** — there is no consumer, so doing so would be inert/speculative (unlike ADR-0068 v1, whose seeded roles had a live `current_user` consumer).

**M2 — gated on the FIRST REAL CONSUMER, not a date.** Build the principal *with* its first user, in this order:
1. **Attribution wiring (non-breaking):** user-less runs carry the automation principal as the **audit actor** (D3). Likely first domino: **migrating `plugin-reports` / audit / ADR-0057 lifecycle jobs off ad-hoc `SYSTEM_CTX` onto the principal** — that migration is what first makes the principal earn its keep.
2. **Authorization (the behavior change):** seed the roles (D1); `runAs:'automation'` becomes the user-less default and runs **RLS-enforced** (D2); assign capabilities/permission-sets to the automation role (ADR-0066). Ship **default-broad → tighten** (the GitHub-Actions playbook) with each flow's effective grants **visible and restrictable**.
- Other trigger to start M2: a **real volume of scheduled CRUD flows** appears (orphan attribution starts to bite). (Multi-tenant is *not* a trigger — it is already handled physically by env-per-DB, ADR-0002.)
- `runAs:'system'` stays god-mode throughout.

**Non-goals / deferred:**
- A full IAM-style per-flow custom-role surface (over-engineering pre-MVP; two built-in roles + permission-set assignment suffice).
- Capability-gating of the automation identity (follows ADR-0066 / cloud#474).
- Re-introducing `usr_system` for seed ownership (explicitly out — seeds keep NULL-then-claim).

---

## Consequences

**Good**
- Pins `runAs` semantics + the automation-identity model **before** the AI authors metadata at scale — the cheap, high-leverage move while the surface is small.
- The v1 guardrail extends the #2308 protection to all user-less triggers and closes the incoherent `runAs:'user'`-on-schedule at author time.
- The end-state closes the fail-open at its root (RLS-enforced named principal) and ends anonymous automation writes (audit/compliance) — **when a consumer makes it worth building**.
- One identity model (automation is just another `current_user` with `roles[]`, ADR-0068) → no new concept for RLS/formula/audit/AI-authoring; and a reusable principal that replaces scattered `SYSTEM_CTX` hacks.
- `runAs:'system'` unchanged → **no migration break**.

**Bad / costs**
- A third `runAs` value enlarges the author surface (justified: it is the safe default and the most-requested real mode) — but reserved-now/built-later means the enum is documented before it is enforced, a small "spec says more than runtime does" window (acceptable per ADR-0049 because it is *marked* target-state, not silently unenforced).
- The M2 authorization flip is a behavior change for user-less flows that today run unscoped — mitigated by default-broad-then-tighten and the long advance notice (the #2308 warning + v1 lint).

## Alternatives considered

- **Build the whole model now (seed roles + principal + runtime).** Rejected: zero current consumer, single-operator, acute risk already mitigated → the speculative over-build ADR-0049 warns against.
- **Keep NULL-then-claim for automation.** Rejected: no claim event for perpetual automation, so attribution never converges; does nothing for authorization.
- **Stop at the #2308 runtime warning.** Necessary but insufficient as the *end-state*: makes the fail-open audible without eliminating it, and leaves writes unattributed — hence this ADR fixes the *model* even though the *build* waits.
- **Fail-closed (deny user-less data ops).** ~~Rejected in #2308: breaks legitimate scheduled CRUD (2/3 example flows relied on the default) and gives no attribution.~~ **ADOPTED 2026-07-28 (#3760)** — see the Amendment above. The example flows this protected now declare `runAs:'system'`, so the stated cost expired; and the attribution objection does not apply, since refusing an operation attributes nothing either way (attribution remains D3's job, unchanged).
- **Reuse `runAs:'system'` for scheduled (silent elevation).** Rejected: hides author intent; the ambient god-mode the four invariants warn against.

## Conformance checklist

**v1 (now):**
1. **`@objectstack/spec`** — document the automation identity as an `EvalUser` (D1) and the three-posture `runAs` semantics (D2) in `FlowSchema.runAs` describe, **marked target-state** for `automation`.
2. **`@objectstack/cli`** — extend `flow-runas-unscoped` to all user-less trigger types; make user-less `runAs:'user'` a hard validation error (D5).

**M2 (gated on first consumer):**
3. **`plugin-security`** — seed the per-environment `automation` `sys_role` row (sibling to `bootstrap-declared-roles`); extend the non-human exclusion guards.
4. **`service-automation`** — `resolveRunContext` resolves user-less runs to the automation `EvalUser`; `runAs:'automation'` threads an RLS-enforcing context (not `isSystem`); stamp the audit actor (D3).
5. **`runtime` / audit** — record the automation actor; do **not** stamp `created_by`/`owner_id` to it (D3).
6. **`plugin-reports`, ADR-0057 jobs** — adopt the principal in place of ad-hoc `SYSTEM_CTX` (the likely first consumer that triggers M2).

## References

- #1888 (flow `runAs` enforcement), #2308 (schedule/user-less fail-open made audible — this ADR's trigger).
- ADR-0049 (enforce-or-mark staging), ADR-0057 (sys_role / scope / lifecycle jobs), ADR-0066 (capabilities), ADR-0068 (EvalUser / identities-as-roles).
