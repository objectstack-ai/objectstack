---
'@objectstack/spec': minor
---

**BREAKING** — retire the CEL predicate arms of `ServiceLevelIndicator.successCriteria`
and `TraceSamplingConfig.composite[].condition`, the two observability predicates nothing
ever evaluated.

Both slots were `z.union([<a structured arm>, <the evaluated expression schema>])`. The
expression arm parsed, normalized a bare string to `{ dialect: 'cel', source }`,
registered, and was served back — and **nothing anywhere evaluated it**. An identity scan
over the whole tree finds every hit for `successCriteria`, `ServiceLevelIndicatorSchema`
and `TraceSamplingConfigSchema` outside `packages/spec/src` to be a generated artefact or
prose; inside it the only readers are the schemas' own unit tests and the two census tests
that enumerate expression slots. No service, plugin, runtime or CLI path reads either key.
So an author — very often an AI reading the generated reference page (ADR-0033) — who
wrote `successCriteria: 'p95 < 300ms'` got a green parse and no signal, indistinguishable
from a predicate that ran and answered.

ADR-0049 enforce-or-remove; maintainer ruling 2026-09-18 (director decision batch #160
item 3, letter A). By the standing criterion that a declared-but-unread capability is kept
only when mainstream platforms in the domain have it: application platforms do not carry
SLI success criteria or trace-sampling conditions as authorable application metadata —
that lives in observability infrastructure (SLO products, OTel sampling policy) and is
structured there, not a free expression. The `cron-declared-unwired` family was retired
outright under the same ADR after the same measurement.

## FROM → TO

| you wrote (17.4 and earlier) | write instead |
| --- | --- |
| `successCriteria: 'p95 < 300ms'` | `successCriteria: { threshold: 300, operator: 'lt', percentile: 0.95 }` — the structured rule this slot has always carried |
| `successCriteria: { dialect: 'cel', source: 'p95 < 300ms' }` | the same structured rule; the envelope spelling goes with the bare-string one |
| `condition: 'record.amount > 10'` on a composite sampling branch | `condition: { service: 'api', attributes: { 'http.route': '/v1/orders' } }` — a structured filter object carrying no `dialect` key |
| `condition: { dialect: 'cel', source: 'record.amount > 10' }` | the same structured filter; an object carrying `dialect` is refused as an expression attempt |

**The one-line fix:** delete the predicate and write the structured shape the slot already
carried. A criterion or a sampling rule the structured shape cannot express has no home in
application metadata at all — it belongs in the SLO product or the OpenTelemetry sampler
configuration that actually evaluates it. ⛔ Do not translate a predicate into a threshold
by guessing the number: nothing was evaluating it, so there is no behaviour to preserve and
a wrong number is worse than an absent one.

## The retirement kit

- **Neither KEY is retired — one ARM of each key's union is.** `successCriteria` and
  `condition` both survive with their structured arm intact, so `retiredKey()` and an
  ADR-0087 D2 strip are both the wrong tool: they retire a key. The prescription hangs on
  the surviving schema's own `error` map, dispatched on `issue.input` — the
  `HookBodyCapability` / `object.managedBy: 'system'` pattern for a narrowing a key
  survives.
- **Where the prescription reaches, measured on zod 4.4.** A schema's `error` map is
  consulted for the top-level `invalid_type` a NON-OBJECT raises, and not for the child
  issues a wrong-shaped OBJECT raises. So on `successCriteria` the bare-string spelling
  carries the prescription and the `{ dialect, source }` envelope is refused by the
  structured arm's own missing-key issues (`threshold`, `operator`). On `condition` both
  spellings carry it, because the structured arm is a record whose aborting `dialect`
  refine sees the object itself. Pinned both ways in the schemas' unit tests, the negative
  included: a value refused for a reason that is NOT the retirement must not borrow its
  sentence.
- **ADR-0087 disposition: a D3 SEMANTIC entry**, `observability-cel-predicates-retired`,
  not a D2 conversion. A predicate is an intent that no threshold/operator pair or
  attribute filter records; a mechanical strip would delete what the author meant and leave
  no trace of which SLI or which sampling branch lost it — and it would not even be lossless
  in the weak sense, because `successCriteria` is REQUIRED (a strip leaves an SLI that no
  longer parses) and a composite branch stripped of its `condition` declares no condition at
  all. That is the one place this retirement parts company with the two precedents it copies
  its MECHANISM from: `crypto.hash` on `HookBodyCapability` and `managedBy: 'system'` both
  ALSO registered a D2 conversion, because for each of them a mechanical rewrite existed.
  Here none does, which is what makes D3 the right disposition rather than merely an
  available one. The prescriptions therefore carry **no** `os migrate meta` sentence — that
  sentence is owed only where a conversion covers the surface.
- **The same-major D3 record is absorbed, per the playbook's 「同 major 记账」.** The
  `evaluated-expression-slots-source-required` entry landed into this same unpublished step,
  and it enumerated these two slots among its 36 declaring positions while instructing the
  upgrader to give a sampling `condition` a dialect and a non-blank `source` — the exact
  envelope this head now refuses. Both entries first ship together, so the composite of the
  two changes is the retirement alone: that entry now reads 34 positions, names the two
  absentees and why, and routes them to this retirement instead of to its own repair.
- **The surviving accept sets are pinned beside the refusals.** `successCriteria` still
  takes `{ threshold, operator, percentile? }`; a composite `condition` still takes any
  filter object carrying no `dialect` key — `{ source: 'x' }` included, because `source`
  alone is an ordinary filter key and the retirement narrowed the `dialect` door only.
- **FOUR published JSON Schemas change projection direction**, and it is mechanical rather
  than chosen: the retired arm held the last `.transform()` in each of these subtrees, so
  each def now projects in output mode instead of falling back to the input shape. All four
  lose `x-io: input`, and what each gains differs:

  | published schema | gains |
  | --- | --- |
  | `system/MetricsConfig` | `default: []` on `slis`, plus 8 `required` members |
  | `system/TracingConfig` | `default: {"type":"always_on","rules":[]}` on `sampling`, plus 4 `required` members |
  | `system/ServiceLevelIndicator` | one `required` member, `enabled` |
  | `system/TraceSamplingConfig` | one `required` member, `rules` |

  Only the first two carry a `default` move, so only those two are declarable in
  `DEFAULT_CHANGES_BY_MAJOR` — the nested pair's `required` growth has no ratchet row to
  live in and is stated here instead. A `required` that lists defaulted keys is this repo's
  existing output-mode convention, not a new one, and the same-category control
  `system/CacheConfig` is untouched. The reference pages show the same signature: the nested
  type cells of both pages lose the `?` from their default-bearing keys. **No runtime default
  moves** — measured twice, by byte-identity of the untouched `.default(…)` and by parsing a
  minimal config on the built package.

## What is deliberately NOT in this change

- **The structured arms.** `{ threshold, operator, percentile }` and the sampling filter
  record are equally unread today. The ruling says so and leaves them to their own card:
  they carry no dialect and are outside the expression ledger's remit.
- **`skills/objectstack-formula/SKILL.md`**, which still lists `metrics` / `tracing` under
  `structured | cel`. The ruling assigns that correction to the skills lane, at tier, and
  this diff does not touch it.
- **`packages/spec/src/shared/expression.zod.ts`.** `EvaluatedExpressionInputSchema` is
  untouched and stays the schema of every remaining evaluated slot; what left is two
  references to it.

Shipped as `minor` under the repo's launch-window convention, in which `major` is refused
by `check-changeset-no-major` and breaking-ness is carried by the banner above plus the
ADR-0087 disposition rather than by the level.

Clause-②: yes (narrowing)

<!-- adr-0087: registered observability-cel-predicates-retired -->
