---
"@objectstack/spec": minor
---

fix(spec): `NormalizedFilterSchema` judges its members instead of catching them all (#7711)

Each `$and` / `$or` member and the `$not` operand was
`z.union([z.record(z.string(), FieldOperatorsSchema), NormalizedFilterSchema])`,
and the second branch was a NON-strict `z.object({ $and, $or, $not })` with every
key optional. "All three of my optional keys are absent" is true of any object
whatsoever, so that branch was a catch-all: whenever the record branch **rejected**
a field condition, the group branch accepted the very same value. The whole-filter
face validated the logical skeleton and nothing else — no comparand shape it
declared could ever make it fail.

Measured before the change, every one of these parsed green while
`FieldOperatorsSchema` — the copy this schema is documented as validating
against — refused the identical operator map:

```
{ $and: [{ c: { $null: 'not-a-boolean' } }] }
{ $and: [{ c: { $between: [1, 2, 3] } }] }
{ $and: [{ hello: 'world' }] }
```

The green was also lossy: an admitted member came back parsed to `{}`, so the
accepted output no longer carried the condition it was asked about — a whole
`{ $not: … }` subtree parsed as a field named `$not` and returned empty.

Now the group branch is `.strict()` and the field-condition branch rules out
`$`-prefixed keys, so a member the operator map refuses has nowhere to land. The
refusal names the offending keys and both valid member shapes:

```
Not a valid $and member — got an object with key(s) "c". A $and member is either
a FIELD CONDITION ({ "field": { "$op": value } }, whose keys are field names and
whose operator map must satisfy FieldOperatorsSchema — comparand shapes
included), or a nested LOGICAL GROUP carrying only $and / $or / $not and nothing
else. Ruled on #7711: declared = enforced (ADR-0049).
```

Graded a narrowing of the accepted surface, so `minor` rather than `patch` — but
the blast radius is measured at zero: nothing in the repo called `.parse` /
`.safeParse` on `NormalizedFilterSchema` outside this package's own tests
(swept with `FilterConditionSchema`'s 20-plus call sites as the positive
control), no driver or evaluator references the normalized AST at all, and the
exported `NormalizedFilter` TYPE is unchanged — every shape that stops parsing
was already outside it. Nothing is removed from the declared surface, which is
what separates this from the ADR-0087 removal grade.

`FilterConditionSchema`, the AUTHORING face every driver, `read-scope-sql` and
`cel-to-filter` actually consume, is untouched and still admits sugar by design,
so no request path's row set can move with this.
