---
"@objectstack/objectql": patch
---

fix(objectql): the fourth tolerant alias reader — `master-detail.ts`'s `referenceTo` tolerance recorded with its measurement, and loud where the alias answered (#13543)

`resolveMasterDetailRelation` accepts the REJECTED alias `referenceTo` beside
the canonical `reference`, and the type beside it stated a population for that
tolerance in one line: *"`referenceTo` is the stored-row spelling."* Nothing in
the tree measured it. This is that measurement, and the tolerance's disposition
after it — the same shape #13541 gave the sibling `controlled_by_parent` reader
in `plugin-security`, arrived at by the same route.

**The census (whole tree, both spellings counted separately, positive controls
run so no zero comes from a pathspec that matches nothing).** Authored object
declarations: **zero**, both spellings — all 8 `Field.masterDetail(...)` and 132
`Field.lookup(...)` declarations across `*.object.ts`, `examples/`,
`packages/qa/` and the `create-objectstack` templates go through the
`@objectstack/spec` builders, which emit the canonical key. Stored-metadata
seeds, JSON/YAML fixtures and `metadata-fs` layouts: **zero**, both spellings.
The nine in-tree files that put `referenceTo` on a field def are all reader
pins. Metadata at rest in a live deployment is **NOT MEASURED** — no command in
this repository reaches it, so the zeros are zeros for the tree, not the world.

**The assertion was wrong, and the correction is the point.** ADR-0087's
`fieldReferenceToAlias` records, in its own docblock, that camelCase
`referenceTo` is deliberately not converted because it "is not the spelling the
objectql runtime wrote into stored object rows" — the stored dialect is
`reference_to`, which this reader does not read. So the line justifying the
tolerance named the wrong spelling, and the docblock now carries the measured
account instead of the assertion.

**The tolerance still stays, for a reason that survived the census.** A raw
`registerObject` skips Zod by design and every caller of this resolver reads
that same `SchemaRegistry`, so an alias-spelled object reaches here verbatim —
now pinned by a test that registers one and resolves it. And the conversion
layer normalises `reference_to` on stored rehydration and `os migrate meta`
while deliberately leaving `referenceTo` alone, which makes `referenceTo` the
one spelling that is simultaneously unconverted upstream and read here. Two of
this resolver's four callers fail **closed**: an unresolved relation leaves
`parent` unbound and `rule-validator.ts` reads an unbound scope root as LOCKED,
so narrowing would take a raw-registered, alias-spelled detail object from
"lock enforced against its header" to "every `parent`-scoped field permanently
unwritable, writes silently stripped". That is an availability defect, not a
spelling correction.

**Loud where the alias is what answered.** When the relation resolves from
`referenceTo`, the resolver reports once per object+field+spelling through an
optional `warn` sink defaulting to `console.warn` — the same caller-supplied
callback shape and default as `warnFunctionalCompleteness` in the same package.
Never a throw, no behaviour change: `referenceKeyOf` selects the key with the
same `!= null` test `??` applies, so a present-but-empty `reference` still wins
the read rather than falling through to the alias. The report is once per
distinct defect rather than per write, because this resolver sits on the write
path and a per-write line is a noise defect of its own. The text also corrects
the registration-time `field/relationship-without-reference` diagnostic, which
calls the same field "runtime-DEAD ... never-resolves" — false for this
consumer, and two diagnostics disagreeing about one field is worse than one.

⛔ Narrowing this reader is not done here and is not licensed by the zeros
above: it is only honest behind a migration that sweeps stored and
raw-registered metadata first. The live-deployment census neither this card nor
its sibling could run is still the open prerequisite.
