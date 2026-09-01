---
"@objectstack/plugin-security": patch
---

fix(plugin-security): `explain` now reports a fail-closed RLS denial as `denies` with `allowed: false` (#13639)

**A wrong answer is corrected — read this if you consume `explain`.** For one
class of request, `explain` previously answered `decision.allowed: true` about a
request that is guaranteed to return zero rows. It now answers `false`.

**The class.** When applicable RLS policies exist but none can be compiled
against the current execution context — typically a required `current_user.*`
variable resolving to nothing, e.g. a caller with no active organization — the
compiler fails **closed** and composes plugin-security's `RLS_DENY_FILTER`
(`{ id: '__rls_deny__:…' }`), a predicate no record can satisfy. Enforcement
was always correct: the caller saw zero rows.

`explain`, however, recognised only its own `__deny_all__` sentinel, so it
reported that composition with layer verdict **`narrows`** and
`decision.allowed: **true**`. That is the diagnostic tool giving an
affirmatively wrong answer to the operator asking why a user sees nothing —
every available signal pointing away from the cause.

**What changed.** Deny recognition is now value-agnostic and routed through one
named predicate, so both the object-level `rls` verdict and the record-grained
layer attribution recognise either sentinel:

- the `rls` layer verdict flips `narrows` → `denies`, with the matching detail;
- `decision.allowed` flips `true` → `false` for this class;
- the record-grained `tenant_isolation` and `rls` layers report the fail-closed
  prose instead of "record does not match" prose.

⭐ **Deliberately NOT changed — no payload moves.** `readFilter` (and a layer's
`rowFilter`) keeps reporting the predicate that was **actually composed**: a
deployment that receives `{ id: '__rls_deny__:…' }` today keeps receiving it
byte-for-byte. The documented `__deny_all__` collapse still fires for
`__deny_all__` alone, and the two sentinels are **not** merged. Rewriting the
published payload, and unifying the sentinel vocabulary, are recorded on #13639
as separate deployment-facing decisions.

**Record-level correctness did not move**, only its prose: the record-grained
`outcome`, `matchesRecord` and rule `effect` were already right, because the
sentinel excludes every real record on its own.

**If you assert on `explain` output**, expectations that encoded the old answer
for a fail-closed RLS denial — verdict `narrows`, or `allowed: true` — now fail,
and they were asserting the defect. Enforcement behaviour is unchanged in every
respect; `explain` is a diagnostic surface and no enforcement path reads its
verdict.
