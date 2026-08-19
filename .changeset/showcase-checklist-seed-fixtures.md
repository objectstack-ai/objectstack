---
"@objectstack/example-showcase": patch
---

Land the showcase seed fixtures the platform checklist could not run without (#9308)

Three capabilities the platform ships had no fixture anywhere in the reference app, so the
checklist items covering them were not failing — they were unrunnable. Each is closed here
with the smallest stock addition that makes it observable, and with the negative control
left intact.

**A second, actually loginable member.** The demo personas (Mei Phone the submitter, Ada
Auditor the sole `auditor`) have existed as `sys_user` rows since #3409/#3411, and neither
could sign in — so every item needing two acting identities was stuck: per-group 会签 needs
the two groups decided by two different people, submitter-side viewer gating needs the
submitter looking at their own request, and an out-of-office delegation is only falsifiable
when the delegate holds a separate token. The non-obvious half is why a password hash was
never enough: better-auth 1.7 keys accounts on `(issuer, providerAccountId)`, so a
credential row carrying any other issuer is invisible to sign-in, which then fails
`INVALID_EMAIL_OR_PASSWORD` behind a "User not found" warn pointing at the user row rather
than at the account. `seed-approval-demo.ts` now provisions the credential account through
better-auth's own `$context` — its hasher, its `internalAdapter.createAccount` — and READS
the issuer off the dev admin's own credential row instead of re-spelling a constant
`plugin-auth` owns, so the two cannot drift. Dev-only by construction: the bootstrap runs
only where the dev admin exists, and that admin is hard-gated on `NODE_ENV=development`.

**An object that opts into `publicSharing`.** No stock object declared it, so
`POST /share-links` answered 422 `SHARING_NOT_ENABLED` for every showcase object and the
whole downstream half of link sharing — resolve, redaction, the audience and password
gates, fail-closed revoke — was unreachable. `showcase_client_brief` opts in with
`redactFields`, an expiry cap and an `eligibility` predicate, and the seed carries both a
`published` brief (mint-eligible) and a `draft` one (refused `RECORD_NOT_ELIGIBLE`) so the
predicate is falsifiable and not merely satisfied. Every other object still declines the
opt-in, which is what keeps the per-object 422 a real control.

**A `readable: false` FLS grant.** The app governed the three `showcase_project` budget
figures with `readable: true, editable: false` — the WRITE half of field-level security —
and authored no read-withheld grant at all, leaving `plugin-security`'s field masker with
no stock fixture. `showcase_client_liaison` is that grant, on the same three fields, so the
two sets read side by side as the two halves of one mechanism. All three figures move
together because `budget_remaining` is a formula over `budget - spent` and masking one
leaks it back through arithmetic.

Downstream reconciliations, each deliberate: `access-matrix.json` gains two rows and moves
none; the persona × CRUD sweep's census follows the matrix (50/50 → 54/54, arithmetic
recorded at the assertion) and its fixture maps learn the new object; the position count
pin follows the new position. The five checklist items whose `knownGaps` this closes are
revised in the same change — gap text kept, marked closed-by-fixture, `revision` bumped,
`history` appended.
