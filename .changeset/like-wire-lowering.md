---
"@objectstack/spec": minor
"@objectstack/driver-sql": minor
"@objectstack/driver-turso": minor
"@objectstack/driver-memory": minor
"@objectstack/formula": minor
"@objectstack/client": patch
---

fix(spec,drivers,formula,client): `like`/`ilike` stop being folded onto `$contains` at the wire (#7536)

A `like` predicate that arrived over HTTP was rewritten into a substring search
before any driver saw it, because `AST_OPERATOR_MAP` (`data/filter.zod.ts`)
carried `'like': '$contains'`. `$contains` LIKE-escapes its comparand and wraps
it in `%…%`, which breaks a `like` in **both** directions at once. Measured in
QA run #7463 against showcase on SQLite:

| filter | before | now |
|---|---|---|
| `["name","like","%Industries"]` | `200`, **0 rows** — the `%` bound as a literal percent sign | the rows ENDING WITH `Industries` |
| `["name","like","Industries"]` | a substring match, **byte-identical to the `$contains` control** | an EXACT match |
| `["name","ilike","…"]` | `400` — `ilike` had no lowering at all, so `isFilterAST()` refused the whole filter | the case-insensitive twin |

The second row is the tell: `like` and `$contains` producing the same bytes
means `like` was not reaching the driver as a pattern at all.

The file already documented the contract being violated. `canonicalAstOperator`,
thirty lines below the map entry, carried a hand-written exemption for
`like`/`ilike` whose comment read: *"they are NOT substring matches at the
driver: driver-sql passes them to SQL verbatim, so the caller binds the
wildcards. Folding them onto `contains` would silently wrap the value in `%…%`
and change what the query means."* That exemption only ever shaped its own
output; the lowering the wire path takes had none. A consequence worth naming:
driver-sql's `like`/`ilike` handling has been unreachable from the wire since
#5158.

## What changed

**New operators `$like` / `$ilike`** on `StringOperatorSchema` and
`FieldOperatorsSchema`. The comparand IS the pattern: `%` matches any sequence,
`_` matches exactly one character, a backslash escapes either, and the pattern
must cover the WHOLE value — so a pattern with no wildcards is an exact
comparison, not a substring search. `$like` is case-SENSITIVE (the #4706 Q2 = A
contract its `$contains` sibling answers); `$ilike` folds ASCII case and nothing
else (Q1 = A), so `café` does not match `CAFÉ`.

`AST_OPERATOR_MAP` now lowers `like` → `$like` and `ilike` → `$ilike`. `ilike`
enters the AST vocabulary for the first time — it previously had no entry, so
`isFilterAST()` refused it. `canonicalAstOperator`'s hand-written exemption is
retired: the generic round-trip answers `like`/`ilike` by construction now, so
the special case is gone along with the reason it existed.

The pattern language is defined **once**, in the spec, and shared by every face
that needs it — `hasDanglingLikeEscape`, `likePatternToRegexSource`,
`matchesLikePattern` and `likePatternToGlobPattern`. Six faces implementing one
pattern language separately is the `#3948` shape reached through translation
instead of vocabulary.

**Which backends answer, and which refuse.** `$like`/`$ilike` are deliberately
NOT in `FILTER_OPERATORS`, the runtime allowlist several packages derive
acceptance from — adding a name there before every face has an arm turns a loud
refusal into a silently DROPPED predicate, which is the widening measured in
#5701 and ruled on in #3948.

| face | `$like` / `$ilike` |
|---|---|
| `driver-sql` (and `driver-sqlite-wasm`, which inherits its compiler) | **answers** — `LIKE` on Postgres/MySQL, `GLOB` on SQLite |
| `driver-turso`, both transports | **answers** — the remote transport compiles independently, holds to the local one by a parity suite |
| `driver-memory`, both faces | **answers** — the in-memory double must not 400 for a filter that works in production |
| `@objectstack/formula` (`matchesFilterCondition`) | **answers** — so a write-side RLS `check` agrees with the read-side SQL |
| `driver-mongodb`, objectql `having`, `service-analytics` | **refuse**, loudly, in the ADR-0112 `INVALID_FILTER` envelope |

The refusals are the point rather than a gap: #7536 exists because a `like` was
silently given `$contains`' meaning, and a face that quietly answers a different
question is worse than one that refuses. Clearing the remainder means arms on
those faces in one PR — the #6520 direction.

**Why SQLite gets `GLOB`.** `$like` is case-exact and SQLite's `LIKE` folds
ASCII unconditionally, which cannot be switched off per statement
(`PRAGMA case_sensitive_like` is connection-global). That is #6518's finding,
and the operator it landed on. Because GLOB speaks a different pattern language
(`*`/`?`, and `%`/`_` are ordinary characters), the pattern is TRANSLATED rather
than escaped — including GLOB's own metacharacters, which are ordinary to LIKE:
an unescaped `*` in a GLOB pattern is the same filter bypass an unescaped `%` is
under LIKE (#5567).

**Refused rather than given a meaning:** a pattern ending in a lone unpaired
backslash. No reading survives every backend — Postgres rejects such a pattern
outright, GLOB has no escape character at all — so it is refused at the door on
every face, by one shared test.

## ⚠️ Behaviour changes

1. **`like` now means `LIKE`.** If you were relying on `like` behaving as a
   substring search — the defect — write `contains` instead. A wildcard-free
   `like` is now an exact match.
2. **`like`/`ilike` on `driver-mongodb`, objectql `having` and analytics now
   return `400 INVALID_FILTER`** where a (wrong) substring answer came back
   before. Write `$contains`/`$icontains` on those backends. `driver-memory` is
   deliberately NOT in that list — it implements the operators, because an
   application whose tests run on the in-memory double and whose production runs
   SQL must not meet a 400 in test for a filter that works in production.
3. **`@objectstack/client`'s `.contains()`, `.startsWith()` and `.endsWith()`
   emit different operators.** They used to build a `like` tuple by gluing
   wildcards onto the caller's value (`[field, 'like', '%' + value + '%']`),
   which was wrong twice over: the wire folded `like` onto `$contains`, which
   escaped the glued `%` back into a literal, so `.contains('name','Corp')`
   searched for the text `%Corp%` and matched only rows containing percent
   signs. And once `like` reaches the driver as a real pattern, the glue becomes
   the *other* bug — a `%` or `_` inside the caller's own value would silently
   become a wildcard. They now emit `contains` / `starts_with` / `ends_with`,
   whose comparand is text. `.like()` is unchanged and finally works; `.ilike()`
   is new.

   Note the case semantics this corrects on paper too: `.contains()`'s docblock
   claimed "case-insensitive", but the `$contains` family is case-SENSITIVE by
   contract (#4706 Q2 = A). Use `.ilike()` for a case-insensitive pattern.
