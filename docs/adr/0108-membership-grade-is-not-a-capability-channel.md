# ADR-0108: Membership Grade Is Not a Capability Channel — the `sys_member.role` Vocabulary Is Closed

**Status**: Accepted (2026-07-28) — implemented in the same PR: the two `role` selects carry
`BUILTIN_MEMBERSHIP_ROLE_OPTIONS` and nothing else, `additionalOrgRoles` and the whole
`plugin-auth/src/org-roles.ts` feed are removed, proven by
`packages/qa/dogfood/test/membership-role-vocabulary.dogfood.test.ts`
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0057](./0057-erp-authorization-core-business-units-and-scope-depth.md) **D4**
(decouple RBAC assignment from better-auth — "never as the authority for RBAC"),
[ADR-0090](./0090-permission-model-v2-concept-convergence.md) **D3** (the `role` → `position` rename
and the word ban) and **D12** (administration as a scoped capability),
[ADR-0095](./0095-authz-kernel-tenant-layer-and-posture-ladder.md) **D3** (posture derives from
capabilities, never from roles), [ADR-0105](./0105-group-tenancy-posture-and-first-class-org-scope.md)
**D8** (scope-bounded invitation issuance and placement)
**Consumers**: `@objectstack/spec`, `@objectstack/plugin-auth`, `@objectstack/platform-objects`,
`@objectstack/lint`, `@objectstack/cli`, `@objectstack/verify`, `@objectstack/plugin-dev`, objectui
**Tracking**: framework#3723 · reverses #3747 and #3779 · related #3697, #3722, #3767

---

## TL;DR

`sys_member.role` answers **"what is your standing in this organization"**. It does not answer
"what may you do". Those are different questions, and for a while one column tried to answer both.

The vocabulary is therefore **closed and framework-owned**: `owner` / `admin` / `delegated_admin` /
`member`. An application's own business roles are **positions**, distributed through
`sys_user_position` — and when the need is "this person should arrive already holding one", the
one-step flow is an **invitation carrying placement** (ADR-0105 D8), not a role name.

This reverses #3747 (app-declared names became storable) and #3779 (they became automatic in every
host). Both were unreleased when this ADR landed.

---

## Context

### What the code actually did

`packages/core/src/security/resolve-authz-context.ts` pushes membership roles and position
assignments into **the same array**:

```ts
for (const m of activeMembers) {
  for (const raw of m.role.split(',')) {
    const r = mapMembershipRole(raw);
    if (!grants.positions.includes(r)) grants.positions.push(r);   // ← membership role
  }
}
const userPositionRows = await tryFind(ql, 'sys_user_position', { user_id: userId }, 200);
for (const ur of userPositionRows) grants.positions.push(ur.position);   // ← the governed path
```

Whatever string is stored in `sys_member.role` **is** a position, by another name. So the question
"which names may be stored there" was never cosmetic — it decided what could be granted without
going through the position system's controls.

The two doors were guarded asymmetrically:

| Write path | Gate |
| :-- | :-- |
| `sys_user_position` | `DelegatedAdminGate` — BU-subtree anchoring, `assignablePermissionSets` allowlist, strict containment, `granted_by` stamp, ADR-0091 validity window |
| `sys_member.role` | grade checks only — no audit stamp, no validity window, no scope check |

`AuthManagerOptions.additionalOrgRoles` registered every `position` / `permission` name a stack
declared with better-auth's organization plugin. #3747 then made those names **storable** (the two
`Field.select`s were widened at boot from the same normalized list), and #3779 made the derivation
**automatic in every host** via a `kernel:ready` hook. What began as "so invitations naming them are
not rejected" had become an ungoverned capability channel, on by default, in every deployment.

### This question already had an answer

- **ADR-0057 D4** introduced `additionalOrgRoles` with an explicit qualifier: feed the names to
  better-auth *"**only** so invitations to those role names are accepted — **never as the authority
  for RBAC**"*, while `sys_member.role` *"shrinks to org-administration"*. The qualifier was the
  whole point, and the projection above is precisely what voided it.
- **ADR-0090 D3** bans the word outright — *"capability = `permission_set` · distribution =
  `position` · hierarchy = `business_unit` · collaboration = `team`. The word 'role' does not exist
  here."* — with one documented exception: `sys_member.role` survives **as third-party schema we do
  not own**, labelled "organization membership". An exception granted to a column we cannot rename
  is not a licence to build a distribution channel on it.
- **ADR-0095 D3** requires that *"no enforcement-time code path may consult the better-auth role
  directly"*, demoting `mapMembershipRole` to a provisioning-time concern.

No ADR ever authorized the widening. It arrived as a bug fix — which is exactly why it needs a
decision record to close.

### The replacement already shipped

ADR-0105 D8 landed **scoped invitation placement**: `sys_invitation` carries `business_unit_id` +
`positions`; issuance is authorized by dry-running `DelegatedAdminGate` against the very
`sys_user_position` rows acceptance would write; acceptance applies them idempotently with a
`granted_by` stamp.

It is a strict superset of what it replaces:

| | membership-role channel (retired) | placement (ADR-0105 D8) |
| :-- | :-- | :-- |
| Who may issue | org owner/admin only — the invitation role cap holds anyone below admin grade to plain `member` | admins **and delegated admins**, within subtree + allowlist |
| What acceptance writes | a string on `sys_member` | real `sys_user_position` rows |
| Audit / validity | none | `granted_by` + ADR-0091 windows |
| Scope checks | none | subtree, allowlist, strict containment |

---

## Decision

### D1 — The membership-role vocabulary is closed

`sys_member.role` and `sys_invitation.role` offer exactly `owner`, `admin`, `delegated_admin`,
`member` — `BUILTIN_MEMBERSHIP_ROLE_OPTIONS` in `@objectstack/spec`, declared statically by the
platform objects. **Nothing widens them at boot.** The closed select is the write-side guardrail
that makes an ungoverned capability grant *unrepresentable*, not a limitation to work around.

A membership role is a **grade**: it decides what a principal may *reach* (`delegated_admin` reaches
`/organization/invite-member`), never what they may *do* with the records behind it.

### D2 — App-declared names are not organization roles

`additionalOrgRoles` is removed from `AuthManagerOptions` and `AuthPluginOptions`, along with
`plugin-auth/src/org-roles.ts` in its entirety (`collectStackOrgRoles`,
`collectRegisteredOrgRoles`, `normalizeAdditionalOrgRoles`, `membershipRoleOptions`,
`withMembershipRoleOptions`) and the `kernel:ready` derivation hook. A stack's `position` /
`permission` metadata is still surfaced and still drives SecurityPlugin — it is simply not fed to
better-auth's role registry.

An invitation naming an app role now fails at better-auth's door with `ROLE_NOT_FOUND`, before any
row is written. Loud and early beats a 400 at the insert (the #3747 symptom) and beats silent
success storing an ungoverned grant (what #3747 shipped).

### D3 — Capability at admission time goes through placement

The migration for every retired use:

```diff
- POST /organization/invite-member { email, role: 'sales_rep' }
+ POST /organization/invite-member { email, role: 'member',
+                                    businessUnitId, positions: ['sales_rep'] }
```

and for an existing member, a `sys_user_position` row through the governed write path.

### D4 — Three facts that look like one; do not merge them

Recorded because "make it one list" is the tempting next refactor, and two thirds of it would be a
modeling error:

1. **what names exist** — `@objectstack/spec`'s `membership-role.ts`. The one list. Everything else
   derives (the platform objects' selects, the lint tier set, objectui's picker).
2. **which names mean administrative authority** — `orgRoleGrade` (invitation cap) and
   `auto-org-admin-grant.ts`. A rule, not a list; it lives next to what it guards.
3. **how a name projects into an identity** — `mapMembershipRole`. Also a rule, also local.

Only (1) is duplication. Unifying (2) and (3) into it would rebuild the conflation this ADR exists
to end.

---

## Consequences

**Positive.**
- The position system has **one entrance**, and every grant through it carries `granted_by`, a
  validity window and a scope check. "Who gave this person this capability, and when does it lapse"
  becomes answerable for every capability, which it was not before.
- ADR-0090 D3's naming commandment is true again in the code, not just in prose.
- Three of the five hand-maintained copies of the vocabulary collapse: the platform objects and the
  lint tier set now derive from `@objectstack/spec` (objectui's mirror is the remaining follow-up).
- Deriving the lint's `MEMBERSHIP_TIERS` immediately fixed a live bug: the hand-kept copy carried
  `guest`, which the select has never offered, so an approver naming it resolved to nobody and the
  lint whose job is to catch that stayed silent.

**Negative / accepted.**
- **Breaking for any host passing `additionalOrgRoles`** — a TypeScript error, deliberately: a
  silently-ignored option would be `declared ≠ enforced` (Prime Directive #10) one more time. The
  changeset carries the FROM → TO mapping.
- A deployment that adopted app-declared org roles between #3747 and this change must migrate to
  positions. Both changesets were unreleased when this landed, so no published version ever offered
  the behaviour; a pre-#3747 deployment could only have reached it by direct DB write.
- **Invitations lose one-step business-role assignment for hosts that have not adopted placement.**
  The capability is not lost — placement covers it and reaches further — but it is a different call
  shape.

**Neutral.**
- `mapMembershipRole`'s passthrough default is retained. With the vocabulary closed it can only ever
  see the four names, but the default keeps a stored legacy value from resolving to `undefined`.

---

## Alternatives considered

**Open the two selects (`Field.text` / `allowOther`).** Makes app roles "work" by widening the
ungoverned door and drops the write-side guardrail entirely. Simplest and most wrong.

**Derive the option list from better-auth's registry (keep #3747, make it reliable).** This is what
#3747 did, and it is the trap: it makes five copies consistent, which reads like a fix, while
promoting "membership role = ungoverned position" from an accident into a formal contract. Making a
wrong design reliable is not fixing it. Deriving becomes correct — and cheap — only *after* the
vocabulary is closed, which is D4 above.

**Lint only (warn when `additionalOrgRoles` is non-empty).** Honest, and it was the original
recommendation before the ADR history surfaced: it moves the failure to authoring time without
changing what the runtime permits. As a first step it needs no decision; as the answer it leaves the
channel open. Superseded by doing the real thing.

**Keep the channel and supersede ADR-0057 D4 / ADR-0090 D3 with a new ADR.** The honest way to keep
#3747 — a decision recorded, not a doctrine quietly reversed by a patch changeset. Rejected on the
merits: with placement shipped there is no capability the channel uniquely provides, so such an ADR
would argue for a weaker, less auditable duplicate of an existing path.

---

## References

- Code: `packages/spec/src/identity/membership-role.ts` (the one list),
  `packages/core/src/security/resolve-authz-context.ts` (the projection),
  `packages/plugins/plugin-security/src/invitation-placement.ts` (ADR-0105 D8),
  `packages/plugins/plugin-auth/src/invitation-role-cap.ts` (grade ceiling),
  `packages/plugins/plugin-security/src/delegated-admin-gate.ts` (ADR-0090 D12).
- Proof: `packages/qa/dogfood/test/membership-role-vocabulary.dogfood.test.ts`,
  `packages/qa/dogfood/test/delegated-admin-invite.dogfood.test.ts`.
- framework#3723 (the finding, revised three times as the cause moved), #3747 / #3779 (reversed
  here), #3767 (`sys_member` governed), objectstack-ai/objectui#2891 (console vocabulary mirror).
