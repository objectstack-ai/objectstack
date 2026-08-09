---
"@objectstack/spec": minor
"@objectstack/driver-memory": minor
"@objectstack/driver-mongodb": minor
"@objectstack/objectql": minor
"@objectstack/formula": minor
"@objectstack/service-analytics": minor
---

feat(spec,drivers,objectql,analytics,formula): `$icontains` reaches every JS evaluation face (#6520)

The other half of #5702. That change implemented `$icontains` on the SQL family
and correctly left the spec's `FILTER_OPERATORS` alone; this one adds the
operator to that array and gives every remaining evaluation face an arm, in ONE
change, because those two steps cannot be separated.

**Why one PR.** `FILTER_OPERATORS` is not a word list, it is a runtime allowlist:
`driver-memory`'s shape gate derives from it, and its matcher's `default:` arm
assumes the gate already refused anything unimplemented. Measured on a branch
that added the name early (#5701): the gate stopped refusing, the matcher fell
through, and `match({ name: 'zzz' }, { name: { $icontains: 'acme' } })` returned
`true` — the predicate silently dropped, every row matched. A dropped predicate
does not narrow a query, it WIDENS it, and on an RLS read scope that is a
permission bypass rather than a degraded feature (#3948). So the word list
travels with the evaluators or not at all.

**What now answers it**, all folding the same domain: `driver-memory` (query
path, reference matcher, and the analytics/cube face), `driver-mongodb`,
`objectql`'s `having`, `@objectstack/formula`'s `matchesFilterCondition` (the RLS
write-side `check`), and `service-analytics`' three SQL compilers (the RLS
lowering, the native-SQL strategy, and the `/analytics/sql` echo).

**The fold is ASCII-only, and that is the contract, not an implementation
detail** (#4706 Q1 = A). `$icontains: 'café'` does not match `CAFÉ`. Every face
reads one shared definition — `foldAsciiCase` /
`asciiCaseInsensitiveContains` / `asciiCaseInsensitiveRegexSource`, new exports
on `@objectstack/spec/data` — because the two obvious per-package spellings are
both wrong in the same direction: `toLowerCase()` folds the whole Unicode range,
and so does a `RegExp` built with the `i` flag. SQLite folds ASCII only and three
of the five drivers are SQLite underneath, so a Unicode fold on a JS face would
re-open exactly the divergence the ruling closed. The pattern-binding faces
(mingo, mongo) therefore emit one `[Aa]` character class per ASCII letter and
pass NO flags; mongo's `$icontains` is the one arm in its family that does not
set `$options: 'i'`.

The comparand keeps the rules its SQL twin has: matched LITERALLY (`%`, `_` and
regex metacharacters are ordinary characters), and refused when empty or
non-string — an empty comparand matches every row, which is a predicate that
constrains nothing.

**User-visible effect.** A filter using `$icontains` now behaves the same on the
in-memory double and on SQL, so an app whose tests run on one and whose
production runs the other stops getting two answers from one filter. Downstream,
#5814 (better-auth `Where.mode: 'insensitive'`) no longer hits a 400 on the
memory double.

Not changed, and still tracked: the `$contains` family still folds Unicode on
`driver-memory`'s query path and `driver-mongodb` (#6682) — both remain DEBT rows
in `scripts/check-driver-conformance.mjs`, now naming one open requirement each
instead of two. `formula`'s unknown-operator posture stays a silent, fail-closed
`false` (it governs a write-side check, where an unevaluable condition denies
rather than widens); the decision and its limits are documented on
`matches-filter.ts`, and no operator the spec DECLARES is answered that way any
more.
