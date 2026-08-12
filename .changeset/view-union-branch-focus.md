---
"@objectstack/spec": patch
---

fix(spec): a failed `view` parse reports the branch the body claims, not the one that complains loudest (#7510)

`ViewMetadataSchema` is a union of four members, and when a `viewKind`-carrying
ViewItem failed on a nested key, the message the author got was the CONTAINER
branch's. Measured through the real write path (`saveMetaItem`) on
`origin/main` @ `9051802`, a form field whose `publicPicker` carried an unknown
`sort` subkey was correctly refused with:

```
[invalid_metadata] view/lead.contact failed spec validation: <root>: Invalid input;
<root>: Unrecognized key(s) on this view container: `viewKind`, `config`.
  • `viewKind` belongs to a single VIEW, not to the container. Wrap it: …
```

The key the author mistyped appears nowhere; what they get instead is a
confident, detailed instruction to restructure a container that was correct all
along — and an author (or an agent) who follows it mangles a working document.

**Why it happened.** Every consumer of a failed union in this repo ranks
branches by `[issue count, carries an unrecognized_keys]`. On such a body the
container branch reports exactly ONE root `unrecognized_keys` (`viewKind` and
`config` are not container keys), while the ViewItem branch reports exactly ONE
nested `invalid_union` whose real key sits one level below where the tiebreak
looks. One issue each, and the unknown-key bonus handed it to the branch that
understood the body least. Not a `publicPicker` quirk: an unknown form-field
key, a bad field enum and a typo'd column summary all reproduced it.

**The fix.** The union now focuses a failed parse on the branch the body
CLAIMS, using `selectViewMetadataBranch` — the same rule `diagnoseViewMetadata`
has answered with since #6391, so Studio's 422 and a consumer's diagnosis can no
longer describe one body two ways. Branches that are not the claimed one are
replaced, in place, by the "wrong kind at the root" issue shape that every
ranking already drops, so the claimed branch is what remains to be rendered.

The card's repro now reads:

```
config.sections.0.fields.0.publicPicker:
  Unrecognized key(s) on this public picker configuration: `sort`.
```

**No acceptance change**, by construction: the focusing is a `$ZodCheck` that
runs after the union has reached its verdict and can only rewrite an existing
issue's `errors` — it adds no issue and removes none. Verdicts, parse output and
top-level issue codes are byte-identical across the 42-body corpus in
`view-union-diagnostics.test.ts` plus 11 more measured for this change. The
`errors` array keeps its length and order for positional consumers, the
`invalid_union` envelope is untouched, a body with no discriminant is left to
the ranking exactly as before, and a genuine container failure still reads the
#4001 wrap prescription verbatim.
