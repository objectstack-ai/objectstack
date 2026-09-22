---
"@objectstack/spec": minor
---

**BREAKING (published artifact narrows)** — `packages/spec/json-schema/**` now states the `$`-prefix key ban a normalized field condition enforces, so a validator reading the published files stops answering PASS on `{"$and":[{"$bogus":{"$eq":1}}]}` at `data/NormalizedFilter` — a document the runtime refuses by name (#18670 item 2, the fifth arm).

Clause-②: yes (narrowing)

One named pattern joins the closed list, and only one:

- **`banned-key-pattern` — "no document may carry a key matching this pattern"**, emitted as `propertyNames` with a `not` over a `pattern`. `NormalizedFilter`'s `$and` / `$or` members and its `$not` operand each admit a field condition whose keys are field names (`amount`, `account.name`) and never `$`-prefixed operators. The published file now says so at all three nodes.

**Scoped, and the scope is mechanical.** The ban is over an OPEN set of names, which is why the existing `banned-keys` arm cannot express it — a finite list that merely sampled the set would be wider than the rule. The pattern arm that can express it is bounded by a second closed list: `BannedKeyPattern` is a union of the pattern strings this package publishes, exactly one today (`^\$`), so a call site cannot invent a regex because there is no `string` to pass, and widening it is the same reviewed decision that adding an arm is. That is what answers the standing objection to a regex-shaped declaration — its over-reach cannot be read off the declaration the way a key list's can, so the bound is on how few declarations exist rather than on trusting the next caller.

**The rows retired, by name.** `packages/spec/dropped-refinements.baseline.json`, entry `data/NormalizedFilter`:

| row | before | after |
|:---|:---|:---|
| `lazy.$and.element.options[0]` | dropped | **deleted** — reads `projected`, arm `banned-key-pattern` |
| `lazy.$or.element.options[0]` | dropped | **deleted** — reads `projected`, arm `banned-key-pattern` |
| `lazy.$not.options[0]` | dropped | **deleted** — reads `projected`, arm `banned-key-pattern` |

**⛔ Not a behaviour change, and no document the runtime accepts becomes refused.** The arm is EXACT rather than approximate. A JSON object's properties are exactly its own enumerable string-keyed ones and `propertyNames` judges exactly those names; JSON Schema specifies `pattern` as an ECMA-262 regular expression evaluated as a SEARCH, which is `RegExp.prototype.test` and nothing else — so the same source text decides the same set of names on both sides. It is presence and never value: a matching key present with a `null` value is present to both. Measured with ajv 8 (draft 2020-12) on the generated file, the verdict vector moves in one direction only: the three `$`-prefixed specimens go `true` → `false`, and every document the runtime accepts — `{}`, the empty combinators `{"$and":[]}` / `{"$or":[{}]}` / `{"$not":{}}`, a nested group, an ordinary field condition — is accepted before and after. Across the published tree, **1530 of 1535 files are byte-identical**; one file changes what it accepts, two change annotation only, and the remaining two are the bundle and the build-input hash.

**The predicate and the keyword are ONE string.** `bannedKeyPattern` compiles its `RegExp` from the declared pattern, so the keyword the file publishes and the rule the runtime enforces cannot come to mean different things — the construction `requiredOneOf`, `dependentRequired` and `bannedKeys` already use, and the reason this arm needs no drift pin either. The `RegExp` carries no flags, which is part of the equality rather than a style choice: a JSON Schema `pattern` has none to carry, and `g` would make `test` stateful through `lastIndex` so a key's verdict would depend on which keys were judged before it.

**A ratchet repair ships with it, and it is what made the rows exist to delete.** The detector decided `dropped` vs `projected` on a two-rung projection ladder while the generator publishes on a three-rung one — a node whose every io direction refuses over an unrepresentable member still reaches its file when that member sits in a union position, because the emit loop drops the branch and publishes the rest. Nine PUBLISHED sites therefore read `undecidable`, the one verdict the ledger does not count: they held no row, carried no `x-dropped-refinements`, and no repair of them could ever have deleted a row. The three nodes this arm closes were three of the nine. The detector now carries the generator's third rung and reports which rung answered, so a differential can never compare a pruned projection with an unpruned one; and a published site that still cannot be adjudicated fails the build by name, so the blind spot cannot reopen in silence.

⚠️ **The ledger therefore GREW before it shrank, and the growth is the point.** Six sites became visible that were previously uncounted — `data/FieldOperators` and `data/RangeOperator` gained `$between.items[0]` / `[1]`, `data/NormalizedFilter` gained the same pair under `$not`, and `data/RangeOperator` entered the ledger as a published schema that had been holding no entry at all — then this arm deleted three. Net across the change: **204 entries / 560 sites → 205 / 566**, with the census at **566 dropped / 205 published schemas / 360 projected** (224 `non-blank-string`, 129 `required-one-of`, 3 `banned-key-pattern`, 2 `dependent-required`, 2 `banned-keys`) and **0 undecidable**, down from 9. Those two files gain annotation only: `x-` keywords are ignored by every validator, so the set of documents they accept is unchanged.

⭐ **Superseding a sibling entry in this same release.** `18670-project-banned-keys.md` records that the `$`-prefix sites 「stay unprojected … they carry NO annotation and hold NO ledger row: published yet unratcheted」. That was a correct reading of its own tree and is no longer true of this one: the sites are projected, the blind spot is closed, and the population it described is empty. The earlier entry is left as the record of what it landed.

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author can write is removed, renamed or re-spelled: no spec key, no export and no config field changes, and the accepted set of metadata documents is byte-for-byte what it was. What changed is a machine-readable DECLARATION catching up with the runtime it always described, so there is nothing for `objectstack migrate meta` to rewrite and no stored representation to convert. -->
