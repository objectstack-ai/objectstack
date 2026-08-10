---
"@objectstack/spec": patch
---

fix(spec): `position.delegatable` no longer names a lint rule that was never written (#6628)

The JSDoc on the authorable `delegatable` key closed with

> so a delegatable position must never distribute an `adminScope`-carrying set
> (enforced by the `security-delegatable-admin-position` lint rule and the D12
> gate).

Only the second of those two enforcers exists. `security-delegatable-admin-position`
occurred **exactly once in the repository** — in that sentence. The security-domain
publish linter's rule table (`packages/lint/src/validate-security-posture.ts`) and its
twelve exported rule-id constants are the authority, and no delegatable/admin-position
rule is among them. The control that makes this a reading rather than a guess:
ADR-0091's *other* author-time rules did land — `security-grant-expired-at-authoring`
(D2) and `security-delegation-missing-reason` (D3, the same decision as `delegatable`)
are both present and both exported — so the absence is specific to this one rule, not
an artefact of the linter skipping ADR-0091.

The invariant itself is real and is enforced: `plugin-security`'s delegated-admin gate
implements the D12 containment check as step 6 of the self-service delegation path.
What was false is **when** it holds. The sentence promised an *author-time* gate, so an
author pairing `delegatable: true` with an `adminScope`-carrying permission set believed
`os lint` would stop them before shipping. It does not — the package publishes clean and
the mistake surfaces later, in a different package, as a runtime deny phrased as a fact
about the position rather than as a fix for the authoring error.

The JSDoc now names only the enforcer that exists and says plainly where it runs: the
D12 gate refuses the delegation at the moment a holder attempts it, denying with the
offending permission set named, so the failure an author will see is a delegation deny
at first use rather than a lint error. It also points at the one author-time rule
ADR-0091 D3 *does* have (`security-delegation-missing-reason`) and says what that one
actually checks, so "no lint rule for this" cannot be misread as "this invariant is
unenforced".

This is text only — a comment inside `position.zod.ts`, which `packages/spec` publishes
to npm via its `src/**/*.zod.ts` files entry, so the corrected prose reaches consumers
and AI authors reading the installed schema source. **`PositionSchema` accepts exactly
what it accepted before**; no key, default, or acceptance behaviour changed, and no
generated artifact moved.

Whether ADR-0091 D3 *should* grow an author-time rule for this combination is a separate
product decision and is deliberately not made here.
