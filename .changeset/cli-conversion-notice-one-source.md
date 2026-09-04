---
"@objectstack/cli": patch
---

refactor(cli): the ADR-0087 conversion notice has one source, and a gate that holds it (#13743)

**No output change.** The sentence `os build`, `os validate` and `os lint`
print for an ADR-0087 D2 conversion is byte-for-byte what it was. What changed
is that there is now exactly one copy of it, and a guard that keeps it that
way.

## Why a changeset at all

`@objectstack/cli` publishes `dist`, which is compiled from the edited `src`,
so this diff changes the published package even though it changes nothing an
author can observe. It is graded `patch` rather than skipped: nothing is added
to the package's public export surface (`src/utils/format.ts` is internal —
the package exports only `.` and `./console`), no CLI flag, payload key or
exit code moves, and no wording moves.

## What was duplicated

The human face of a conversion notice was written out three times, verbatim:

```
packages/cli/src/commands/compile.ts    printWarning(`…`)
packages/cli/src/commands/lint.ts       printWarning(`…`)
packages/cli/src/commands/validate.ts   warnings.push(`…`)
```

Measured on the branch point: one distinct template literal across the three,
124 bytes each. They were held equal by convention alone. The parity guard in
`packages/cli/test/validate-build-gate-parity.test.ts` asserts that each
command **passes** an `onConversionNotice` sink to `normalizeStackInput` — it
never asserted they **say the same thing** once they have one, so a reword in
one command diverged from the other two with every gate green.

That matters more than ordinary duplication because the sentence is close to a
contract: a conversion rewrites the old shape and asks the author for nothing,
so this notice is the only warning they get before the conversion retires from
the load path and their metadata stops loading. An author who runs two of the
three commands over one tree is meant to be told the same thing in the same
words.

## What changed

`formatConversionNotice(notice)` in `src/utils/format.ts` is now the single
source of the sentence, and all three commands render through it.

It is a **formatter, not a printer**, and that is what makes one
implementation possible. The three call sites are genuinely not
interchangeable in what they DO with the string — `os build` and `os lint`
hand it to `printWarning` behind `!flags.json`, while `os validate` pushes it
into the `warnings` list that `--strict` then judges — but they were identical
in what they SAY. The whole difference lives in the disposition of the
returned string, so it costs the function no parameter.

The parity guard gains the rule it could not see: every authoring command
renders through the one formatter, and none spells the sentence out inline —
with a positive control, so it cannot go green on a CLI that says nothing at
all. `src/utils/format.conversion-notice.test.ts` pins the rendered sentence
itself.

## What is deliberately NOT unified

`ConversionNotice.message` (built in `packages/spec/src/conversions/apply.ts`)
and the `defineStack:` warning (`packages/spec/src/stack.zod.ts`) are two
further renderings of the same fields, in different registers and for
different audiences. Neither is touched here, and neither can read this
function — `@objectstack/cli` depends on `@objectstack/spec`, not the reverse.
Whether all of them should descend from one source is a separate question,
filed separately.
