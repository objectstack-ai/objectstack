---
'@objectstack/spec': minor
---

fix(spec): four lookup folds no longer hand out `Object.prototype` members for an off-vocabulary key (#17818)

`normalizeFilterOperator` (`/ui`), `resolveDiscoveryEnvironment` (`/api`), and
`pluralToSingular` / `singularToPlural` (`/meta-spelling`, re-exported from
`/shared`) each read a module-level lookup table with a runtime key through a
bare index. Every one of those tables is an ordinary object, so a key that is
not in the vocabulary resolved a member of `Object.prototype` instead of
falling through — and the `?? fallback` each function already writes never
fired, because the inherited member is truthy.

Measured on Node v22.22.2, before and after — each fold evaluated at this
change's implementation and again at its merge base, against the TypeScript
sources that the build and the test run both consume:

| call | before | after |
|:--|:--|:--|
| `normalizeFilterOperator('constructor')` | the `Object` function | `'constructor'` |
| `normalizeFilterOperator('toString')` | `Object.prototype.toString` | `'toString'` |
| `normalizeFilterOperator('valueOf')` | `Object.prototype.valueOf` | `'valueOf'` |
| `normalizeFilterOperator('__proto__')` | `Object.prototype` | `'__proto__'` |
| `resolveDiscoveryEnvironment('constructor')` | the `Object` function | `'development'` |
| `resolveDiscoveryEnvironment('__proto__')` | `Object.prototype` | `'development'` |
| `pluralToSingular('constructor')` | the `Object` function | `'constructor'` |
| `singularToPlural('__proto__')` | `Object.prototype` | `'__proto__'` |

Each function's declared refusal value is what it now answers — the same value
each already gave for an ordinary unknown word such as `nope`. ⛔ No new
fallback was invented. `resolveDiscoveryEnvironment` is the sharpest case: its
own docblock promises "a value guaranteed to satisfy
`DiscoveryEnvironmentSchema`", and for `constructor` it returned a `Function`.

⚠️ **Why `minor` and not `patch`.** The level is carried by this change's
declared contract-review status, ⛔ not by a widening — the guard only NARROWS.
An off-vocabulary key that previously resolved an inherited member now gets each
function's own declared refusal value, and nothing that answered before answers
differently. Nothing in the declared vocabulary moves: every canonical operator,
every `EnvironmentType` bucket, both operator shorthands and every manifest
collection spelling answers byte-identically to before, and the only inputs
whose answer changes are the four prototype-member spellings above, which no
signature ever admitted.

The guard is the `Object.prototype.hasOwnProperty.call(table, key) && table[key]`
shape already landed in `src/data/type-compat.ts`, and carries that site's two
recorded rejections: ⛔ not a null-prototype table (it does not type-check
against the `Record` annotation, and the spelling that does compile silently
costs the exhaustiveness check), and ⛔ not a list of prototype member names
(which the next prototype member defeats).
