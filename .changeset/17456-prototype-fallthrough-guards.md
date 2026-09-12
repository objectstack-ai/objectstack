---
'@objectstack/spec': patch
---

fix(spec): three more lookups refuse an off-vocabulary key instead of handing back an `Object.prototype` member

`BASE_ALIASES` / `DIALECT_ALIASES` (`canonicalizeSqlType`),
`DEFAULT_VALUE_TOKEN_SUGGESTIONS` (`suggestDefaultValueToken`) and
`CONTEXT_TOKEN_SUGGESTIONS` (`classifyFilterToken`) are plain object literals, so
all three inherit `Object.prototype`, and every lookup into them was a bare
index. Measured by importing the BUILT artifact (`dist/data/index.mjs`) on the
repo's Node 22 baseline (v22.22.2) and driving each function — the same way the
two landed siblings in this family were measured — over a fixed population of
five: `constructor`, `toString`, `valueOf`, `__proto__` and a plain unknown word.

| call | before | after |
|:--|:--|:--|
| `canonicalizeSqlType('varchar')` | `'text'` | `'text'` — unmoved |
| `canonicalizeSqlType('timestamptz', 'postgres')` | `'datetime'` | `'datetime'` — unmoved |
| `canonicalizeSqlType('constructor')` | the `Object` **function**, out of a signature that admits only `CanonicalSqlType` string literals | `'unknown'` |
| `canonicalizeSqlType('constructor', <any dialect>)` | the `Object` **function** | `'unknown'` |
| `canonicalizeSqlType('__proto__')` | `'array'` | `'array'` — unmoved; the array-notation rule answers ahead of either table |
| `canonicalizeSqlType('toString' / 'valueOf' / 'nope')` | `'unknown'` | `'unknown'` — unmoved |
| `suggestFieldTypeForSqlType('constructor')` | **`TypeError: Cannot read properties of undefined (reading 'suggested')`** | `undefined` |
| `isCompatible('constructor', 'text')` | **`TypeError: … (reading 'exact')`** | `'lossy'` |
| `suggestDefaultValueToken('currentuser')` | `'current_user'` | `'current_user'` — unmoved |
| `suggestDefaultValueToken('constructor')` | the `Object` **function** | `undefined` |
| `suggestDefaultValueToken('__proto__')` | `Object.prototype` — an **object** | `undefined` |
| `classifyFilterToken('{current_user}').suggestion` | `'current_user_id'` | `'current_user_id'` — unmoved |
| `classifyFilterToken('{constructor}').suggestion` | the `Object` **function**, in a field declared `ContextToken` | `undefined` |
| `classifyFilterToken('{__proto__}').suggestion` | `Object.prototype` | `undefined` |

The two `TypeError` rows are the sharpest consequence and were not previously
recorded: a non-`CanonicalSqlType` reaches `CANONICAL_TO_FIELD[canonical]`, which
is `undefined`, so both published sibling accessors threw on the member read
rather than merely returning something off-contract. `canonicalizeSqlType`'s
`rawType` comes off live database introspection, which is where an
attacker-free, entirely accidental `constructor` actually comes from.

`classifyFilterToken`'s half is the one a type-checked consumer meets: the
declared `suggestion?: ContextToken` was a compile-time guarantee that was false
at runtime, and nothing in the type system would ever have flagged it. Its
wrapped-token regex captures `[^{}]+` — anything but braces — so the reachable
key set is not the identifier-shaped one; what bounds it is the `toLowerCase()`,
which leaves exactly the lower-case-stable prototype members (`constructor`,
`__proto__`) namable today. `toString` / `valueOf` were quiet by that casing
accident alone, not by a guard.

All three sites now go through an `Object.prototype.hasOwnProperty.call` check
returning each function's own already-declared refusal value — `'unknown'`,
`undefined`, and an absent `suggestion` respectively. No declared signature
changes. This narrows and widens nothing an author can reach: every legal
spelling is an own key of its table, so nothing accepted before is refused now,
and only answers that were never inside the declared return types move.

A null-prototype table was the other available shape and is not taken, for the
reason the two landed siblings measured rather than assumed: a `__proto__: null`
object literal does not type-check against the `Record<…>` annotation at all
(TS2353), and the `Object.assign(Object.create(null), …)` spelling that does
compile silently costs that annotation's exhaustiveness check (TS2741 stopped
firing for a table missing a member). A quiet failure is worse than a loud one.
