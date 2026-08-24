---
'@objectstack/plugin-auth': patch
'@objectstack/types': patch
---

An organization no longer stops accepting members at 100 — membership is not a
limited axis, and the ceiling nobody chose is now stated explicitly

A customer adding users was refused with `Organization membership limit
reached`. Nothing in this codebase set that ceiling: better-auth's organization
plugin substitutes a vendor default of **100** for an absent `membershipLimit`
(`count >= (membershipLimit || 100)` in `routes/crud-members`), and
`auth-manager` passed `organizationLimit` — how many organizations one user may
CREATE — while never passing `membershipLimit`, which is a different question.

The two read almost identically in a config block and mean nothing alike, which
is why the gap survived: the option that WAS set looked like the option that
was not. In the field the refusal is worse than merely wrong — it arrives while
an operator is looking at licences and seat counts, and reads as an entitlement
problem on an axis that carries no entitlement at all. Seats are metered on AI
usage; plain membership has never been billed.

- `membershipLimit` is now passed explicitly, defaulting to unbounded.
- `OS_ORG_MEMBERSHIP_LIMIT` is the opt-in for a deployment that DOES want a
  ceiling (a pilot, a trial tenant). Unusable values (empty, non-numeric,
  zero, negative) read as unset rather than as a cap — a typo must not be the
  thing that locks an organization, which is exactly the failure mode being
  fixed.
- The decision lives in `resolveMembershipLimitOption()` rather than inside the
  plugin-construction expression, so it is testable: the unset case, the
  explicit ceiling, the unusable-value direction, and — deliberately — that the
  chosen value clears the vendor's 100 by a wide margin. If a future
  better-auth changes that default, the test says so instead of leaving an
  unexplained constant behind.

The unbounded value is `Number.MAX_SAFE_INTEGER`, not `Infinity`: the option is
compared numerically but also travels through option plumbing that may assume a
finite value, and nine quadrillion members is unlimited by any measure that
reaches a real deployment.
