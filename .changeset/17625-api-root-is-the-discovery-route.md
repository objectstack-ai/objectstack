---
'@objectstack/runtime': minor
---

fix(runtime): the API root is the discovery route, under a second spelling — a gated session's `GET ${prefix}/` reaches discovery again (#17625)

`HttpDispatcher.dispatch()` strips one trailing slash, so both root spellings it
accepts collapsed onto the empty string: `${prefix}/` arrives as `/` and
`${prefix}` arrives as `` (the MSW / base-URL-stripped form). Only the discovery
branch at the foot of the method knew that empty string meant the API root. The
ADR-0069 authentication-policy gate, which runs far above it, did not.

That disagreement was invisible while `isAuthGateAllowlisted` answered `true`
for a falsy path. objectstack#7898 made the predicate fail-closed at the source
— exemption is now something a path EARNS by naming an allow-listed route — and
the bare-root discovery request started answering 403 for a session carrying an
`authGate` posture (expired password, required MFA):

```
FROM  GET ${prefix}/   (session with user.authGate)  ->  200  discovery document
TO    GET ${prefix}/   (session with user.authGate)  ->  403  PASSWORD_EXPIRED   // regression
NOW   GET ${prefix}/   (session with user.authGate)  ->  200  discovery document
```

**Normalising the root to `/` is measured insufficient and is not what landed.**
`isAuthGateAllowlisted('/')` is `false` — a segment-less path matches no
`ALLOW_ROUTES` entry — and the discovery branch tests `/discovery` or the empty
string, neither of which `/` satisfies. `'' -> '/'` therefore relocates the 403
rather than removing it. Both legs are pinned upstream in
`packages/core/src/security/auth-gate.test.ts` ("does not exempt the dispatcher
bare-root `cleanPath` — step 2 is #17625").

The root is canonicalised to `/discovery` instead — the route it has always
served — read from one constant by both the canonicalisation and the branch that
serves it, so the two cannot drift into a third disagreement about what the
empty path means.

**⛔ No allow-list was widened and `packages/core` is untouched.** The only input
whose gate answer moves is the API root, and it gains exactly the exemption
`/discovery` already carried, by BEING that route — no new information is
reachable, since `/discovery` was already exempt and already outside the
project-membership skip check. A caller that reaches the gate with no path at
all is still refused at the predicate, and the pathless case stays declared
where it lives (`shouldDenyAnonymous`) rather than re-derived at this seam.

**What does NOT change.** `${prefix}` with no trailing slash keeps serving the
same document; the named `/discovery` route is untouched; the
environment-scoped root `${prefix}/environments/<id>` keeps its own answer,
which matched no allow-listed route before objectstack#7898 either. `//` strips
to `/`, not to the empty string, so it is not the root and is not canonicalised.

**Why `minor` on a change whose commit type is `fix`.** The two are independent
and the floor is mechanical, not editorial: this PR's clause ② is declared
affirmative, and the maintainer's ruling of 2026-09-04 (decision batch #35, on
objectstack#15294) puts an affirmative clause ② on a package whose
`packages/**/src/**` the diff moves at AT LEAST `minor` — *the commit type may
raise a bump but never lower it below what the act requires*, written out under
"WHICH LEVEL" in the `Check Changeset` step of
`.github/workflows/pr-automation.yml`. ⛔ So the reading that this is "a 403 that
should be a 200, therefore a patch" is an argument about INTENT and does not
reach the level: the act re-admits an input class the merged tree refuses, on an
authorisation surface, and that is what the level grades. The commit type stays
`fix(runtime)`, because the type describes the act and the level prices it.

**ADR-0087 disposition: no ledger entry is owed and no marker is required.**
This changeset declares no breaking change, which is the only condition under
which `check:adr-0087-registration` demands a disposition marker. On the
substance: no ADR-0087 shape surface moved — the diff touches one
`packages/runtime` transport file and its sibling test, no `*.zod.ts`, no
`packages/spec/**`, no `packages/spec/src/contracts/**` entry and no object
definition — so `objectstack migrate meta` has nothing to reach, and no
authorable metadata key, accept set or stored shape changes. Nor is this an
ADR-0087 conversion-layer entry: nothing lenient is being accepted from a
metadata producer. One transport's two spellings of its own route are being
reconciled to the route's own name, which is the opposite direction — a dialect
removed, not tolerated.
