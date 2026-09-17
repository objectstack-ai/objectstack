---
"@objectstack/spec": minor
"@objectstack/formula": minor
---

feat(spec)!: every engine-evaluated expression slot requires a non-blank `source` — the #15430 rule generalised from the flow-node ledger to the other 36 declaring positions (#15811, decision batch #122 item 2)

<!-- adr-0087: registered evaluated-expression-slots-source-required -->

**BREAKING** accept-set narrowing on 36 published metadata slots. Each of them
composed `ExpressionInputSchema` and now composes `EvaluatedExpressionInputSchema`,
so an envelope carrying only `ast` (`{ dialect: 'cel', ast: … }` with no `source`)
and a `source` that is blank after trimming — through the envelope key or through
the bare-string shorthand — are refused at the door instead of parsing and then
faulting at run time. The prescription is registered under protocol major 18 as
the semantic migration `evaluated-expression-slots-source-required`.

**⚠️ Graded `minor`, not `major`, and the ruling said `major`.** Decision batch
#122 item 3 ordered a 「`major` changeset」. This repo's launch-window convention
ships breaking changes as `minor` while the fixed group versions in lockstep, and
`scripts/check-changeset-no-major.mjs` enforces it: a `major` marker here would
promote all ~70 packages to a whole-stack major release, which is a release act.
The convention's own written carriers for breaking-ness are used instead and both
are present — this **BREAKING** banner and the ADR-0087 disposition above. The
ruling's substance (a breaking narrowing, carried by an ADR-0087 semantic
migration entry) is delivered; only the marker differs, and it differs because a
repo gate forbids the marker.

**What is NOT narrowed.** `ExpressionSchema` / `ExpressionInputSchema` remain the
persistence contract (`source` OR `ast`), by item 2 of the same ruling, and so
does `PredicateInputSchema`, which is a plain alias of the latter. A slot that
only PERSISTS an envelope is untouched; the narrowing is at the slots an engine
EVALUATES. An `ast` carried BESIDE a string `source` stays admitted everywhere.

**The population was re-derived, not inherited.** By identity — a negative
lookaround on identifier characters, so `CronExpressionInputSchema` and
`TemplateExpressionInputSchema` cannot leak in as substrings — over
`packages/spec/src`, non-test: 34 declaring source lines, two of which are
file-local alias consts (`ui/action.zod.ts` `ActionConditionInputSchema`,
`system/settings-manifest.zod.ts` `SettingsVisibilityInputSchema`) that mount two
slots each, giving **36 declaring positions**. Three of them reach the schema as a
union member rather than head-of-declaration (`RecordAlertProps.visible`,
`ServiceLevelIndicator.successCriteria`, `TraceSamplingConfig.composite[].condition`).

On **two of those three the sibling arm is untouched**: `RecordAlertProps.visible`
still takes a boolean literal, and `ServiceLevelIndicator.successCriteria` still
takes its structured `{ threshold, operator, percentile? }` object — including one
that happens to carry a `dialect` key.

⚠️ **On the third, `TraceSamplingConfig.composite[].condition`, the sibling arm
narrows too, and deliberately.** Its structured-filter arm is a bare
`z.record(z.string(), z.unknown())`, which accepted `{ dialect: 'cel', ast }` as an
ordinary filter — so swapping the expression arm changed nothing at all there. That
arm now declines any object carrying a `dialect` key, and six shapes the base
accepted THROUGH THAT ARM ALONE (measured: the base's `ExpressionInputSchema`
refused every one of them) are refused at this slot:

| authored `condition` | base | now |
|---|---|---|
| `{ dialect: 'cel' }` | accepted | refused |
| `{ dialect: 'js', source: 'x' }` | accepted | refused |
| `{ dialect: 'nope', source: 'x' }` | accepted | refused |
| `{ dialect: 'cel', source: 5 }` | accepted | refused |
| `{ dialect: 'cel', source: 'x', meta: { rationale: 5 } }` | accepted | refused |
| `{ dialect: 'zzz', foo: 1 }` | accepted | refused |

FROM → TO at that slot: if the value really is a **structured filter**, drop the
`dialect` key (`{ dialect: 'cel', service: 'api' }` → `{ service: 'api' }`); if it is
an **expression**, give it a dialect this platform evaluates and a non-blank `source`
(`{ dialect: 'js', source: 'x' }` → `{ dialect: 'cel', source: 'x' }`). A structured
filter that carries no `dialect` key — `{}`, `{ service: 'api' }`,
`{ attributes: { 'http.route': '/v1/orders' } }` — is accepted exactly as before.

**Why an authoring-time refusal and not a run-time one.** Measured at the
chokepoint, `celEngine.evaluate` never silently succeeds on either shape — it
returns a `parse` fault — so what happened next was decided entirely by the
slot's fail policy, and the two halves of that population fail in opposite
directions: fail-CLOSED slots (`ObjectFieldGroup.visibleWhen`,
`RowCrudActionOverride.visibleWhen`, `BulkActionDef.visible`, the two
settings-manifest `visible` slots) hid a group, a row button, or silently excluded
every selected record from a bulk run and reported them as *skipped*; fail-SOFT
slots left a gate that had stopped gating. Nothing in between said a word: the
authoring lint `validateVisibilityPredicates` measured 0 findings on an `ast`-only
envelope and 0 on a blank `source`, against two control legs that each measured 1.

**`@objectstack/formula` gains `printCelAst(ast)`** — the inverse of
`parseCelToAst`, and the lossless half of the migration: an `ast`-only CEL
envelope is printed back to surface syntax mechanically, with no judgment asked of
the author. It is lossless about MEANING, not bytes (the printer re-renders from
the parse tree, so `'x'` comes back as `"x"`), and it answers `null` — never a
guess — for anything it cannot round-trip through the platform's own bounded
parser. That `null`, and every blank `source`, are what the semantic migration
entry's structured TODO covers.

**The published TypeScript interface `RowCrudPredicates` narrows with it**
(`Expression | ExpressionInput` → `EvaluatedExpression | EvaluatedExpressionInput`),
because it mirrors the two `RowCrudActionOverride` slots and a type that still
promised an `ast`-only envelope would advertise what the schema now refuses.
