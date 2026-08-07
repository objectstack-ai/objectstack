---
"@objectstack/spec": major
---

fix(spec)!: `HierarchyScopeContext` carries the tenancy posture, so single-posture DEPTH is legal (#6139)

Two accepted positions contradicted each other on `main`, and a resolver could
not satisfy both:

1. `IHierarchyScopeResolver.resolveOwnerIds` obliged an implementation to fail
   CLOSED whenever `organizationId` was `null` — unconditionally, "no org is not
   every org" (#5852/#5973).
2. Ruling C (#5859, landed in PR #6067) requires a single-posture deployment —
   one with no organizations at all — to feed an explicit `null` and still get
   hierarchy DEPTH.

`HierarchyScopeContext` had no way to tell those two `null`s apart, so a
strictly spec-conformant resolver (cloud PR #1196 fails closed unconditionally,
exactly as written) necessarily killed enterprise DEPTH on every single-posture
install. The contract demanded the behaviour the platform ruling forbade.

**FROM** `{ userId, organizationId: string | null, tenantId?: string | null }`,
with `null` organization ⇒ fail closed, always.
**TO** the same plus a REQUIRED `posture: TenancyPosture` (ADR-0105 D1), with
the obligation now read from BOTH fields:

- `posture: 'single'` + `organizationId: null` — **legitimate.** There is no
  organization dimension at all, so `null` names the one implicit tenant. The
  resolver MUST proceed and resolve DEPTH normally; refusing here retires
  hierarchy scoping for every org-less deployment.
- `posture: 'group' | 'isolated'` + `organizationId: null` — **fail closed,
  strictly.** A wall is in force, so `null` is a missing constraint. This half
  is unchanged and unrelaxed: it is what closed the #5852 cross-organization
  privilege escalation.

A structured signal was chosen over prose ("single-posture deployments are
exempt") because prose cannot be read by the code that must act on it: the
resolver runs inside the enterprise package and needs the deployment fact at
call time, not a paragraph.

`posture` is REQUIRED, on the same terms and for the same reason #5858 made
`organizationId` required: a producer that omits it must fail to COMPILE rather
than hand every resolver an `undefined` to guess about, when one guess leaks
across organizations and the other silently kills DEPTH. This is a breaking
change for anyone CONSTRUCTING a `HierarchyScopeContext`; implementors of
`IHierarchyScopeResolver` are source-compatible, though a resolver keying only
on `organizationId` is no longer conformant and should adopt the two-field read.

Supplying it costs producers nothing new: the open sharing layer already
resolved the posture to decide whether to consult a resolver at all. That
derivation now lives in one place (`effectiveTenancyPosture()`), with the local
refusal expressed in terms of it, so the refusal and the reported posture cannot
drift apart. It still fails closed — an unresolvable posture reports the
strictest walled posture, never `single`.

The `showcase-scope-depth` dogfood proofs now run a **spec-conformant**
reference resolver typed against the real interface. The previous fixture took
`c: any` and ignored the tenancy fields entirely, which is why 20 single-posture
e2e proofs stayed green throughout: no spec-conformant resolver was ever
exercised, so CI could not see the contradiction. Verified non-vacuous — with
the old unconditional rule restored, three DEPTH proofs fail.
