---
"@objectstack/plugin-auth": minor
---

fix(auth): an unrecognised membership policy is refused by both reconcilers, not auto-bound by one of them (#5205)

**The sign-up path used to bind anyway.** `reconcileMembership` and
`backfillMemberships` — both public exports of `@objectstack/plugin-auth` — read
the same `policy` field and judged it with opposite predicates. Sign-up tested
`policy === 'invite-only'`, so any *other* value fell through to the `auto`
branch and auto-bound the new user; the backfill tested `policy !== 'auto'` and
refused. One input, two opposite postures, and the fail-open half was the one
that runs per sign-up. A caller who wrote `'inviteOnly'` — or any host passing
the policy from JavaScript, past the `MembershipPolicy` type — got auto-binding
while believing they had switched it off, with nothing in the logs to say so.

Both entry points now check `isMembershipPolicy()` before any policy semantics
and refuse: nothing is bound, and the refusal names the offending value at
`error` level (and on the returned result, so it survives a caller that passed
no logger). This is the posture #5152 took one layer up at the settings
boundary — an unrecognised value is rejected loudly, never coerced to `auto`.

**Contract change — `ReconcileOutcome` gains `'invalid-policy'`, and
`BackfillMembershipsResult.reason` gains the same member.** Both are exported
types, so a consumer that switches exhaustively over them (a `never`-checked
`default`, or a `Record< ReconcileOutcome, … >`) must handle the new member.
The new verdict is deliberately *not* a reuse of the existing `policy-skip` /
`'policy'`: those mean "a valid policy said no", and reporting them for "this
is not a policy" sends whoever is debugging a missing bind to inspect a
deployment setting that is fine. `BackfillMembershipsResult` also gains an
optional `error?: string`, and the `logger` shape on `ReconcileMembershipDeps`
gains an optional `error?` method (it falls back to `warn`).

**No behaviour change for the two real policies.** `auto` binds and
`invite-only` skips exactly as before, on both paths — the framework's own
callers resolve the policy through `AuthManager.getMembershipPolicy()`, whose
return type is `MembershipPolicy`, so nothing on a supported path can reach the
new branch. This closes the dormant divergence on the export surface.
