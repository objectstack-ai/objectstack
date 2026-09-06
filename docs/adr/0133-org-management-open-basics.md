# ADR-0133: Organization management — the open basics; a mirror of cloud ADR-0081 D1/D3/D4 in the repository whose code enforces them

- **Status**: Proposed (2026-09-06) — awaiting the maintainer's hand-merge, which is the acceptance act for a governed surface (Prime Directive #14). ⛔ Nothing in this file is a new decision; see [Provenance](#provenance--read-this-before-citing-this-file).
- **Mirrors**: `objectstack-ai/cloud` **ADR-0081** (Status: Accepted, founder-decided in session, 2026-07-09) — **D1, D3 and D4 only**, the half whose mechanism is open code in this repository.
- **Deliberately not mirrored**: cloud ADR-0081 **D2**, its non-goals, and its commercial consequences. Those govern a packaging choice, stay in cloud, and are cited as `cloud ADR-0081` — never restated here. See [Relationship to the D2 reversal](#relationship-to-the-d2-reversal-16215).
- **Cross-checked against** (cite, do not duplicate): [ADR-0093](./0093-tenancy-mode-and-membership-lifecycle.md) (tenancy mode; the membership lifecycle; D9 already anchors the active-organization resolution), [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md) (group tenancy posture; D12 anchors the multi-org entitlement), [ADR-0131](./0131-total-organization-ownership-no-null-organization-id.md) (total organization ownership; D1/D7/D9)
- **Filed by**: [#14508](https://github.com/objectstack-ai/objectstack/issues/14508), a sub-issue of [#14496](https://github.com/objectstack-ai/objectstack/issues/14496) (maintainer ruling 2026-09-02, option 2: mirror the open half, do not move files)
- **Consumers**: `@objectstack/platform-objects` (the identity surface and the Setup navigation contributions), `@objectstack/plugin-auth` (better-auth's organization plugin and the default-organization bootstrap), `@objectstack/spec` (the public auth-feature roster), and the objectui console that renders the surface

---

## Provenance — read this before citing this file

**The decisions restated below were taken in the sibling `objectstack-ai/cloud`
repository, as cloud ADR-0081, on 2026-07-09.** They were founder-decided in
session and accepted there. This file decides nothing. It is a mirror, written
on 2026-09-06 from the cloud record plus the code in this repository that
implements it.

Three facts make that disclosure load-bearing rather than decorative:

1. **Only the mechanism half is here.** Cloud ADR-0081 covers both what the
   platform does and what a subscription buys. A decision about commercial
   packaging belongs in the commercial repository; a decision about open code
   belongs where the code is (Prime Directive #13). This file therefore carries
   **D1, D3 and D4** and stops. Where this document and the cloud record
   disagree, **the cloud record is the decision and this file is the bug** —
   file an issue and this file gets corrected.

2. ⚠️ **`ADR-0081` written bare resolves to the wrong document in this
   repository.** This repo's [ADR-0081](./0081-trusted-react-page-tier.md) is
   the trusted `kind:'react'` page tier, an unrelated record whose Decision
   section is not even D-numbered. Every reference to the organization-
   management record must be spelled `cloud ADR-0081`. This is the third local
   record to say so — ADR-0093 D9 and ADR-0105's citation note say it for the
   labels `ADR-0081 D1` and `ADR-0081 D2` respectively — and it is repeated
   here because this file is the one a reader following those citations now
   lands on.

3. **The code still carries the pre-repo labels.** Several files in
   `packages/platform-objects` and `packages/plugins/plugin-auth` cite
   `ADR-0081 D1` in comments today. Re-pointing those citations is
   [#14361](https://github.com/objectstack-ai/objectstack/issues/14361)'s work
   and is ⛔ **not** done by the change that lands this file — so until that
   card lands, a reader may arrive here from a citation that names a different
   number.

**What is restated vs. what is measured.** Every clause under
[Decision](#decision) is either a restatement of the cloud record or a fact
measured on this repository's `origin/main` at `77781151d` and cited by symbol
anchor. Where the two disagree, or where the cloud record is silent about
something this repo's code decides, it is recorded under
[What this record does not decide](#what-this-record-does-not-decide) rather
than resolved.

---

## Relationship to the D2 reversal (#16215)

**A separate local record — "The multi-organization runtime is open core" —
reverses cloud ADR-0081 D2.** It is open as a draft PR
([#16215](https://github.com/objectstack-ai/objectstack/pull/16215)) and is not
yet on `main`.

⛔ **It is referenced here by PR number and never by its ADR number, and that is
a gate requirement rather than a style choice.** `pnpm check:adr-anchors` fails
any citation of an ADR number that names no record under `docs/adr/`: an
unmerged number is a squat, and every citation of it is retroactively falsified
if the record lands under a different number. A PR reference cannot rot that
way. **When #16215 merges, its number becomes citable and this file should be
updated to use it** — that edit is cheap, mechanical, and owed to whichever of
the two records lands second.

The division of labour between the two records is exact and neither restates
the other:

| cloud ADR-0081 | who carries it locally |
|---|---|
| **D1** — the "add a teammate" basics stay open | **this record** |
| **D2** — the multi-organization machinery is enterprise | the record proposed in **#16215**, which reverses it. ⛔ Not re-derived, restated or evaluated here |
| **D3** — the in-shell organization surface | **this record** |
| **D4** — org-scoped roster reads | **this record** |
| the non-goals and the commercial consequences | stay in cloud, cited as `cloud ADR-0081` |

⚠️ **A note for the hand-merge, stated rather than decided.** #16215's record
says in its own "What this record does not decide" section that D1/D3/D4 "are
mirrored into this repository by #14508", and asks that writer to cite its
decisions rather than open a *competing* record — which this file does: it
decides nothing that record decides. A later comment on #14508 goes further and
proposes folding D1/D3/D4 into that file instead of writing a second one. That
option was not available to this change: the file does not exist on `main`, so
"extending" it would mean building on an unmerged governed PR and coupling two
hand-merges into one. **If the maintainer prefers one combined record, that is a
merge-time call** — the two files are disjoint, so folding them is a move, not a
rewrite.

---

## Context

The open framework has always shipped member-management basics: better-auth's
organization plugin mounted in `plugin-auth`, the organization and invitation
objects in `platform-objects`, and the Setup surface over them. What was
enterprise was the *multi-organization runtime*, not the ability to add a
colleague to the organization you already have.

That boundary is easy to get wrong in exactly one direction — quietly treating
"organization" as an enterprise word and gating a basic affordance on the
multi-org service. Cloud ADR-0081 D1 is the decision that forbids it, and the
code says so at each gate: the invite affordance is gated on the org
**capability**, never on multi-org. This record exists so that gate has a local
number to cite.

---

## Decision

⛔ **Nothing here is decided by this file.** The D-numbers are cloud ADR-0081's
own, deliberately **not** renumbered: a mirror that renumbers is a mirror a
reader cannot check against its original. D2 is absent for the reason given
above, so the sequence reads D1, D3, D4.

### D1 — Adding a teammate is open, and always goes through better-auth invitations

Basic member management is not an entitlement. The better-auth organization
plugin is mounted unconditionally
(`packages/plugins/plugin-auth/src/auth-schema-config.ts#buildOrganizationPluginSchema`),
and single-organization deployments get a Default Organization from the
bootstrap helper
(`packages/plugins/plugin-auth/src/ensure-default-organization.ts#ensureDefaultOrganization`,
`#isDefaultOrganizationBootstrapTrigger`) so that the endpoint's active-organization
resolution has something to resolve.

Two consequences this repository enforces:

- **The gate is the organization capability, never multi-org.** The invite
  action declares `requiresFeature: 'organization'`
  (`packages/platform-objects/src/identity/sys-user.object.ts#requiresFeature`),
  and the spec's public roster keeps the two features apart: the member-management
  inputs sit under the organization capability while organization *lifecycle*
  actions sit under `packages/spec/src/kernel/public-auth-features.ts#multiOrgEnabled`
  (`#gatedInputs`). ADR-0093 D8 already records that this split is deliberate;
  it is cited, not re-argued.
- **Every add flows through an invitation.** There is no bespoke user-CRUD path
  into membership. `invite_user` targets better-auth's invite-member endpoint and
  is declared on three objects, so it is reachable from wherever an admin
  happens to be looking:
  `packages/platform-objects/src/identity/sys-user.object.ts#invite_user`,
  `packages/platform-objects/src/identity/sys-invitation.object.ts#invite_user`,
  and `packages/platform-objects/src/identity/sys-member.object.ts#invite_user`.
  The three copies are held equal to each other — not to hand-copied literals —
  by `packages/platform-objects/src/identity/invite-entry-toolbar.test.ts#INVITE_ENDPOINT`
  and `#OBJECTS_BY_NAME`.

⚠️ Membership rows are **read-only over the API**: `sys_member` declares
`packages/platform-objects/src/identity/sys-member.object.ts#apiMethods` as reads
only, and writes are owned by better-auth behind the identity write guard
(ADR-0092 D2). "Open" here means *the affordance is not gated*, not *the table
is writable*.

### D3 — The in-shell surface is the organization RECORD page, reached by a templated nav deep-link

What **this repository declares** is a navigation contribution: an `object`-typed
Setup entry naming `sys_organization` with a templated `recordId` of
`{current_org_id}`, in the People & Org group
(`packages/platform-objects/src/apps/setup-nav.contributions.ts#nav_organization`).
Its siblings — `#nav_teams`, `#nav_invitations` — carry **no** service gate, while
the organization *list* keeps one (`#nav_organizations`, `requiresService: 'org-scoping'`):
browsing organizations is meaningful only when more than one can exist. That
asymmetry is D1 expressed in navigation.

**The rendering half is objectui's, and this repository does not enforce it.**
The console pinned by `.objectui-sha` substitutes the token and, when it cannot
resolve, falls through to the list view rather than emitting a dead link
(`objectui:packages/layout/src/NavigationRenderer.tsx#applyNavTemplate`,
`#NavTemplateContext`, `#resolveHref`); related-list toolbars are bridged in
declaration order by
`objectui:packages/app-shell/src/views/RelatedRecordActionsBridge.tsx#deriveActions`.
Those are objectui's behaviours, cited here so a reader can find them — ⛔ this
record does not make them contracts of this repository, and a change to them is
not a violation of this record.

⚠️ **The tab set and its ordering are NOT declared by this repository, and this
record does not decide them.** See
[What this record does not decide](#what-this-record-does-not-decide).

### D4 — Control-plane roster reads are organization-scoped

`sys_member` is organization-scoped: it carries
`packages/platform-objects/src/identity/sys-member.object.ts#organization_id` as a
lookup to `sys_organization`, is uniquely indexed on the organization/user pair
(`#indexes`), and pairs that column with `#user_id` and `#role`. The
organization-capability gate on the identity surface is the same one D1 names.

⛔ **This record does not restate what "org-scoped" now means — ADR-0131 owns it.**
Since cloud ADR-0081 was accepted, [ADR-0131](./0131-total-organization-ownership-no-null-organization-id.md)
(merged 2026-09-04) decided organization ownership for every row in the system,
and it supersedes any reading of D4 as an opt-in property:

- **D1/D9** — a row with an organization column was written by an organization,
  the column is `NOT NULL`, and a missing stamp is a refused write in every
  posture. Org-scoping is the default; the exception is a table with **no**
  column.
- **D7** — whether a given object *keeps* the column at all is a **writer-facts**
  question decided per object by the C7 inventory, not by the object's name.

⚠️ Consequently, **whether `sys_member` keeps its column is not decided here.**
Today the field is declared optional and its own comment describes a null
organization under single-tenancy — a reading ADR-0131 D1 does not permit going
forward. That reconciliation belongs to ADR-0131's C6 census
([#15207](https://github.com/objectstack-ai/objectstack/issues/15207)), and this
record cites it rather than pre-empting it, exactly as it cites ADR-0093 rather
than restating the membership lifecycle.

---

## What this record does not decide

This section is the honest residue: places where the cloud record is silent, or
where this repository's code and its own comments do not agree. ⛔ None of it is
resolved here.

1. ⭐ **"Opens on tab-0 Members" is asserted in this repository's comments but
   declared by none of its metadata.** Two source comments and a QA checklist
   item describe the organization record page as opening on a Members tab with
   Invitations and Teams beside it. Measured on `origin/main` at `77781151d`,
   **no object in `packages/platform-objects/src/identity/` declares the
   `relatedList` prominence key** (`packages/spec/src/data/field.zod.ts#relatedList`)
   — the key objectui reads to promote a child list to its own tab — and no
   `relatedLayout` override exists anywhere in this repository. Under the
   documented default, with no primary list declared, related lists collapse
   into a single stacked tab. So the tab ordering is either an emergent property
   of the renderer or a claim that has gone stale; **this record states the
   deep-link contract, which is declared, and does not assert a tab order, which
   is not.** Filed separately rather than repaired here.

2. **Whether `sys_member` keeps `organization_id`** — ADR-0131 D7's writer-facts
   question, answered by the C6 census (#15207). See D4.

3. **The reconciliation of the optional column with ADR-0131 D1.** The field is
   declared optional today and ADR-0131 D1 says no nullable tenant column exists
   anywhere. That is a migration question on ADR-0131's own v18 line (its D10
   and D14), not a mirror's to settle.

4. **What an enterprise subscription buys, and where the multi-organization
   machinery lives.** Cloud ADR-0081 D2 and the record proposed in #16215,
   respectively. ⛔ Not evaluated here.

---

## Consequences

**Good.** The three local records that already carry pieces of this decision —
ADR-0093 D9, ADR-0105 D12, ADR-0131 D1/D7/D9 — stop being the only local anchors
for a decision none of them owns. A reader who follows an `ADR-0081 D1` citation
out of the identity surface can now be sent somewhere that answers, which is the
precondition for #14361's re-pointing work.

**Costs, stated plainly.** One decision is now recorded in two repositories, and
mirrors drift: this file has to be corrected when cloud ADR-0081 changes, and
nothing mechanical will notice. The mitigation is the Provenance section's
precedence rule (the cloud record decides) rather than a gate. The cloud record
also owes a one-line pointer back to this number; that edit belongs to the cloud
repository and is not made by the change that lands this file.

**Reversibility.** Total — this file decides nothing, so deleting it costs only
the citations that point at it.
