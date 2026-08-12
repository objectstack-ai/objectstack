---
'@objectstack/plugin-sharing': patch
'@objectstack/spec': patch
---

fix(sharing): enforce `publicSharing.eligibility` when a share link is created

`publicSharing.eligibility` was declared with a TSDoc promising the predicate
would be evaluated against the candidate record at link creation and refuse with
422 — and nothing read it. `ShareLinkService.getPolicy()` built its policy from
the five sibling keys (`enabled`, `allowedAudiences`, `allowedPermissions`,
`maxExpiryDays`, `redactFields`), all of which were genuinely enforced, and
skipped this one, so `createLink` ran no predicate at all.

The consequence was not confined to link creation: `resolveToken` has no auth
check and reads the record under a system context, so any staff user who could
read a record could publish it to the open internet past a policy the object
author wrote specifically to prevent that — with no error raised.

`createLink` now evaluates the predicate against the candidate record before the
insert. An ineligible record is refused with `422 RECORD_NOT_ELIGIBLE`, and a
predicate that cannot be compiled or that faults on the record is refused with
`422 ELIGIBILITY_UNEVALUABLE` rather than issued past an unanswered policy — a
restrictive policy must never fail open. Objects that declare no `eligibility`
key are unaffected, down to the record read's field projection.

The predicate is evaluated by `@objectstack/formula`'s record-level CEL engine —
the same evaluator the server-side validation and hook-condition gates use, and
the same canonical CEL front end sharing rules parse through. Sharing rules
additionally lower their condition to a pushdown filter because they select a
set of records inside a query; eligibility judges one record already in hand, so
record-level constructs such as `has(record.x)` — which the pushdown compiler
rejects — evaluate normally here.
