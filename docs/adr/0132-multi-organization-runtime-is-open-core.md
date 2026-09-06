# ADR-0132: The multi-organization runtime is open core — single-database organization isolation ships open; only the entitlement stays commercial

- **Status**: Proposed (2026-09-06) — awaiting the maintainer's hand-merge, which is itself the
  acceptance act for a governed surface (Prime Directive #14). ⛔ Nothing below is settled until
  this record merges.
- **Deciders**: ObjectStack maintainer, 2026-09-06, live chat, verbatim and untranslated: the
  question that opened it 「感觉 单库多组织隔离是开源基本需求，如果迁移回开源项目成本有多大」, the
  instruction that chartered the work 「直接立专题卡派发处理吧」, and the statement of the effect
  the migration is measured against 「迁移之后的效果应该是开源版就可以把元数据应用使用单库多租户的方式运行。」
- **Reverses**: cloud ADR-0081 **D2** (the multi-organization machinery closes into an enterprise
  package). D1, D3 and D4 of that record are untouched — see
  [What this record does not decide](#what-this-record-does-not-decide).
- **Amends**: [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) **D12** — the
  edition split's *code vs. activation* line is unchanged, but D12's argument for putting the
  `supportedPostures` declaration in the commercial runtime no longer applies to the open package.
- **Builds on**: [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) D5 (degraded tenancy
  fails fast — the refusal an open install meets today),
  [ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) D1 (the tenant Layer 0 that is
  already open), [ADR-0049](./0049-no-unenforced-security-properties.md) (enforce or remove — the
  posture this record applies to a wall that can be configured but not enforced),
  [ADR-0131](./0131-total-organization-ownership-no-null-organization-id.md) D9 (no silent NULL
  organization stamping)
- **Evidence**: [#16130](https://github.com/objectstack-ai/objectstack/issues/16130) (the card, its
  phase-1 line-level classification of all 1660 lines, and the PM's binding answers)
- **Discharged elsewhere**: [#16137](https://github.com/objectstack-ai/objectstack/issues/16137) —
  an open-only install actually raising the wall. ⛔ This record does not claim it.

---

## Provenance — read this before citing this file

The decision this file reverses was taken in the sibling `objectstack-ai/cloud`
repository, as **cloud ADR-0081** (Accepted, founder-decided in session,
2026-07-09), whose **D2** put the multi-organization machinery into a
closed-source enterprise package. That record governs a commercial packaging
choice, so it lives there and is cited from here as `cloud ADR-0081` — never as
a bare number, which resolves against *this* repository's ADR-0081 (the trusted
`kind:'react'` page tier, an unrelated document).

This file is the mechanism half, in the repository whose code it now governs,
per Prime Directive #13. The commercial half — what an enterprise subscription
buys, and the licence gate that answers for it — stays in cloud and is **not**
restated here. The cloud record needs a one-line pointer back to this number;
that edit belongs to the commercial repository and is not made by the PR that
lands this file.

⚠️ Where this document and the cloud record disagree about what the *commercial*
boundary is, the cloud record decides. What this document decides, and cloud
does not, is where the **code** lives.

---

## Context — the wall was already open; only the switch was closed

Every part of single-database organization isolation was already Apache-2.0 in
this repository, and had been through three cross-organization repairs in the
week before this record was written:

| piece | where |
|---|---|
| the wall itself | open — `plugin-security`'s tenant Layer 0, and the three postures in `packages/spec` |
| the posture knob | open — `resolveTenancyPosture()` in `packages/types` |
| organizations and invitations as objects | open — `platform-objects`' identity surface |
| organization CRUD, membership, invitations | open — better-auth's organization plugin, mounted in `plugin-auth` (cloud ADR-0081 D1) |
| the Setup surface for it | open — the `requiresService: 'org-scoping'` navigation gates |
| **the `org-scoping` registrar** | ⛔ closed — the one missing piece |

The consequence was precise and bad. An open-source install that set
`OS_TENANCY_POSTURE=isolated` **could not enforce it**. `serve` treats every
posture but `single` as multi-tenant, finds no `org-scoping` runtime, and
refuses the boot (ADR-0093 D5) — correctly. The only route past that refusal was
`OS_ALLOW_DEGRADED_TENANCY=1`, which boots with the wall *configured but not
enforced*: exactly the shape ADR-0049 refuses in general and ADR-0131 D9 refuses
for this surface in particular.

So the open edition did not offer a weaker wall. It offered a wall that could be
asked for and never raised — and the honest reading of ADR-0016's iron rule
(强制免费、治理收费, "enforcement is free, governance is paid") is that a wall is
enforcement.

### The move was measured before it was made

Phase 1 of #16130 classified all 1660 lines of the closed package line by line,
read through `git show origin/main:PATH` in both repositories rather than a
working tree. 1300 lines move (1265 as-is, 35 changed), 342 stay, 18 are
deleted. Coupling to the commercial repository was exactly two import sites,
both entitlement. None of the four stop conditions the card set — a third
coupling point, an inseparable membership gate, any need for
`security-enterprise` — fired.

---

## Decision

### D1 — The multi-organization runtime is open core

`@objectstack/organizations` ships from this repository, Apache-2.0, as
`packages/plugins/organizations`. It registers the `org-scoping` service, the
`organization_id` insert auto-stamp, the per-organization seed replay, the
default-organization bootstrap and the walled-posture membership-policy gate.

This reverses cloud ADR-0081 D2's placement of that machinery and nothing else
about that record.

### D2 — The entitlement, and only the entitlement, stays commercial

The commercial repository keeps its licence gate and the entitlement it answers
for. The open class carries **no licence check of any kind**: no gate call, no
constructor option, no callback, no hook, no protected method that exists to be
overridden for gating, and no way to detect which edition it is running under.

The commercial package keeps construction-time refusal by **subclassing**: its
own `OrganizationsPlugin extends` the open class and calls its gate in its own
constructor. Cloud code, cloud gate. This preserves the requirement cloud#1020
records — that the gate be answered by the package that implements multi-org, at
construction — with no seam on the open side, and it leaves the two existing
`new X.OrganizationsPlugin()` call sites and `serve`'s two-stage classifier
(which keys on *which stage threw*, not on the error's shape) working unchanged.

### D3 — One name, two packages; the declaring manifest decides which

Both packages are named `@objectstack/organizations`. That is the mechanism, not
a collision to repair:

- every commercial host declares `"@objectstack/organizations": "workspace:*"`,
  and pnpm's `workspace:` protocol resolves **only** to the local workspace
  package — it cannot fall through to the registry, and a missing one fails the
  install rather than substituting silently;
- an open install declares the same name from npm and gets the open package;
- `objectstack serve` reaches it through the host-anchored importer, which
  refuses a package the served app has not declared at all (#4719), so the
  resolution base is always the served app's own manifest.

Taking the name the loader already spells is what makes this migration require
**no loader change**: `ORGANIZATIONS_RUNTIME_PKG` and every pin over it are
untouched.

⛔ **The one thing that would break D3**, and it is therefore forbidden: a
framework package taking `@objectstack/organizations` as its own dependency.
The commercial repository consumes the framework by `link:`, so such a
dependency would place the ungated package inside the framework tree a
commercial app links against, reachable by a bare import that never consults the
app's manifest — the entitlement bypassed by resolution rather than by any
defect in the gate. Apps declare this package; packages do not. A pin in the
package holds it.

### D4 — The open package entitles both walled postures, by construction

ADR-0105 D12 put the `supportedPostures` declaration in the commercial runtime
on the argument that "which shapes of multi-org" is a *packaging* decision open
core should not hard-code. For the open package there is no packaging decision
left to make: an installation that has the package has the wall, in both of the
shapes the wall comes in. `['group', 'isolated']` is the open runtime's own
constant, not a tier.

⛔ And it is not a place a tier may later be drawn. The declaration in the closed
runtime carried a comment advertising that "gating it behind a licence flag …
becomes a one-line edit HERE". In an open file that sentence is an invitation to
add exactly the check D2 forbids, sitting in the file where it would go; it is
reworded at the move, and the ⛔ replacing it is part of this decision rather
than editorial tidying.

*ADR-0105 D12 is otherwise unchanged.* Its code-vs-activation split still holds,
and the commercial runtime may still narrow what **it** entitles.

### D5 — The multi-node gate carrier stays commercial-only

`MULTI_NODE_GATE_CARRIER_PACKAGES` names two packages, and the open package
acquires neither obligation nor the `security-enterprise` import that discharges
it. One consequence is a changed **diagnostic** on an open install, recorded so
it is not read as a regression: that carrier's import used to fail
(`unavailable`) and now succeeds while registering nothing
(`loaded-without-gate`). Both leave no gate registered, so the fail-closed
default refuses a multi-node verdict exactly as before. ⛔ The fix for the new
outcome is not to teach the open package to register a gate.

### D6 — The service name `org-scoping` does not change

It survived the move out and it survives the move back. The open core's
`getService('org-scoping')` probes and the `requiresService: 'org-scoping'`
navigation gates are anchored on it; renaming it would silently flip RLS posture
and unmount the Setup surface across every deployment. The plugin id
`com.objectstack.organizations` is kept for the same reason.

---

## What this record does not decide

- **It does not deliver the acceptance.** An open-only install that sets
  `OS_TENANCY_POSTURE=isolated` with `OS_ALLOW_DEGRADED_TENANCY` **unset**,
  boots with the wall active and enforces the isolation matrix — that is
  #16137, which is blocked on this, and where it is measured. Shipping the
  registrar is a necessary condition, not the acceptance.
- **It does not touch cloud ADR-0081 D1, D3 or D4** — the open member-management
  basics, the organization record page, and the org-scoped roster reads. Those
  are mirrored into this repository by
  [#14508](https://github.com/objectstack-ai/objectstack/issues/14508), which was
  unstarted when this file was written. ⚠️ That card's Shape section says D2
  "stays in cloud"; this record is what makes that line stale, and its writer
  should cite this number rather than open a competing record.
- **It does not change what an enterprise subscription buys.** The commercial
  surface ADR-0105 D12 lists is untouched.

---

## Consequences

**Good.** An open-source deployment can run a metadata application in
single-database multi-tenant mode — the maintainer's stated effect. The
open tree stops shipping a posture it can accept and cannot honour, closing an
ADR-0049 instance in the security-sensitive direction. The three
cross-organization repairs already landed in the open tree gain a runtime that
can actually exercise them.

**Costs, stated plainly.** One package name now denotes two packages, which is a
real hazard managed by a real mechanism (D3) plus a pin, not by convention.
Documentation and one spec roster row that described the runtime as
closed-source and absent from npm become wrong on merge and are corrected in the
same change. And the commercial repository owes a follow-up PR — bump its
framework pin, delete what moved, subclass, keep the gate — without which its
package still carries a full copy of the moved code.

**Reversibility.** High. The commercial package can re-absorb the code by
un-subclassing; nothing in the open tree depends on this package, by D3's own
prohibition.
