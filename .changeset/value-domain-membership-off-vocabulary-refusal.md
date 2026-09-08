---
'@objectstack/spec': patch
---

fix(spec): `isValueDomainMember` refuses an off-vocabulary domain instead of failing OPEN on `Object.prototype` names

`DOMAIN_MEMBERSHIP` is an object literal, so it inherits `Object.prototype`, and
`isValueDomainMember` indexed it with no own-property guard. Measured against the
built artifact (`dist/shared/index.mjs`) on the repo's Node 22 baseline (v22.22.2),
an off-vocabulary `domain` did one of two wrong things — and one of them was a
membership FALSE POSITIVE out of a predicate whose whole job is to refuse
non-members:

| `domain` | before | after |
|:--|:--|:--|
| `iana_time_zone` (in vocabulary) | `true` for `UTC` | `true` for `UTC` — unmoved |
| `toString` | `'[object Object]'` — a truthy **string** | `false` |
| `valueOf` | a truthy **object** | `false` |
| `constructor` | a truthy **object** | `false` |
| `__proto__` | threw a `TypeError` | `false` |
| `nope`, `''` | threw a `TypeError` | `false` |

**Why it is reachable.** "Unreachable in-repo" is not "unreachable". The parameter
is typed `ValueDomain` and every in-repo call site names a member, but
`isValueDomainMember` is **published** on `@objectstack/spec/shared` (it is in
`packages/spec/api-surface/shared.json`). A plain-JS consumer, or any caller
handing over a domain string read from **metadata** rather than written in source,
reaches it with no type checking at all — and metadata-sourced strings are exactly
where `constructor` and `toString` show up.

**This narrows and widens nothing, measured rather than asserted.** Every accepted
`domain` is an own key of the record, so no value that was accepted before is
refused now; the three real domains answer from their own definitions, unmoved.
The change is one `Object.prototype.hasOwnProperty.call` guard — the same spelling
the `iso_4217_currency` definition in the same module already uses — returning
`false` for a domain that is not an own key. A **null-prototype record** was the
other shape available and was not taken: it converts the truthy answers into
throws rather than into `false`, and it costs the `Readonly<Record<ValueDomain, …>>`
annotation that makes a vocabulary member added without a definition fail to
compile.

**Unknown domain answers `false`; it does not throw.** `false` is the narrowing
reading — it refuses more and accepts nothing new — whereas a thrown refusal would
change published behaviour for callers who today receive a truthy value. This is
the same third branch a sister ruling settled for the same defect family: list
reject / own-member value / prototype-resolvable ⇒ reject.

The pin that existed did not cover this, and the fix is as much about its
POPULATION as about the guard: the totality pin asserted the return `typeof` was
`boolean` but iterated `ValueDomainSchema.options` **only** — exactly the domains
that behave. The new pins put `toString`, `valueOf`, `constructor`,
`hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable`, `__proto__` and plainly
absent words into the population, and a third pin holds that population honest by
asserting every one of them is still outside the vocabulary.
