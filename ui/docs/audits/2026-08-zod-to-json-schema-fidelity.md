# Audit: zod to JSON Schema conversion fidelity for `@object-ui/types` (2026-08)

**Card**: objectui#5392 — the measurement the 2026-08-22 ruling required before the
A / B / C fork on shipping a generated JSON Schema is decided.
**Measured on**: `claude/issue-5392-json-schema-fidelity-measurement` @ `12dcdc110`, a
merge of `origin/main` @ `50d0d6cc5` — **with** objectui#6117 (`CRUDSchema` retired), see
[Base](#base-and-the-6117-delta).
**Status**: This is a measurement. No generator, no drift gate and no published
artifact are proposed or added by it. The fork stays open.

---

## Summary

| Question | Answer |
| --- | --- |
| Converter | `z.toJSONSchema()`, built in to **zod 4.4.3** — already a dependency, no new one needed |
| Population | `AnyComponentSchema` — 14 union members expanding to **105 leaf node schemas** |
| Converts under **default** options | **0 / 105** — every node type throws |
| Converts under **lenient** options | **105 / 105** |
| Faithful (nothing lost) | **0 / 105** |
| Degraded | **105 / 105** |
| Artifact size | **651,908 bytes** pretty · 369,028 minified · 55,529 gzipped |
| Added to the published package | **+21.5 %** of `dist` pretty, **+12.2 %** minified |
| Is the artifact closed? | **No.** 276 of 333 objects are open; every one of the 105 node roots is open; `.strict()` is called **0** times in the mirrors |
| Is it stricter than zod anywhere? | **No — 0 / 475** corpus files. It is a strict *relaxation* |
| Would objectui#5127's skipped files gain judgement? | **Partly, and not because of the artifact** — see [Q3](#q3-the-objectui5127-judgement-surface) |

**The headline.** The generated artifact is a **strict relaxation** of the zod
source: over the repo's 475 root-`type` JSON files it agrees with
`safeValidateSchema` on 461 (97.1 %), is **weaker** on 14, and is **stricter on none**.
Every judgement it can deliver, `safeValidateSchema` already delivers today — and
delivers better. What shipping it would add is a 369–652 KB published document, a
generator, a drift gate, and a contract that *reads* closed (`properties`, `required`,
`const` on `type`) while resolving `additionalProperties` to an accept-anything schema on
all 105 node types and having silently discarded all five cross-field predicates in the
source.

---

## The converter

```
zod version : 4.4.3          (packages/types dependency "zod": "^4.4.3")
entry point : z.toJSONSchema(schema, options)
dialect     : https://json-schema.org/draft/2020-12/schema
```

Fidelity is a property of a specific converter, so it is named: this is **zod's own
built-in**, not a third-party library. It is the right choice here because it needs no
new dependency — the package that would ship the artifact already depends on the
converter as the source of the mirrors.

The repo does carry `zod-to-json-schema@3.25.2` in `pnpm-lock.yaml`, but it is a
transitive dependency pinned to `zod@3.25.76`. It cannot convert these zod-4 shapes and
is not a candidate.

Two option sets are used throughout, and the distinction carries most of the result:

| leg | options | meaning |
| --- | --- | --- |
| **strict** | defaults | zod **throws** on anything it cannot represent |
| **lenient** | `{ unrepresentable: 'any', cycles: 'ref', reused: 'ref', io: 'input' }` | zod emits `{}` instead of throwing |

A real generator must use the lenient leg — the strict leg converts nothing. **Choosing
to generate is choosing to opt in to silent lossiness**, and that is a property of this
vocabulary, not of the converter.

## How the population was chosen

The barrel `@object-ui/types/zod` exports **194** zod symbols. That is the wrong
population: most are sub-shapes (`CRUDPagination`, `DetailViewTab`, `FilterUI`) that an
author never writes at a node position.

The population measured is **`AnyComponentSchema`** — the union that
`validateSchema()` / `safeValidateSchema()` parse, and therefore exactly the contract a
generated artifact would describe. Its 14 union members expand recursively to **105 leaf
node schemas**, which is the set of `type:` values an author can write:

> AccordionSchema, ActionSchema, AlertDialogSchema, AlertSchema, AppComponentSchema, AspectRatioSchema, AvatarSchema, BadgeSchema, BlockEditorSchema, BlockInstanceSchema, BlockLibrarySchema, BlockSchema, ButtonGroupSchema, ButtonSchema, CRUDDialogSchema, CalendarSchema, CalendarViewSchema, CardSchema, CarouselSchema, ChartSchema, ChatbotSchema, CheckboxSchema, CollapsibleSchema, ComboboxSchema, CommandSchema, ComponentSchema, ContainerSchema, ContextMenuSchema, DashboardComponentSchema, DataTableSchema, DatePickerSchema, DetailSchema, DetailViewSchema, DialogSchema, DivSchema, DrawerSchema, DropdownMenuSchema, EmptySchema, FileUploadSchema, FilterBuilderSchema, FilterUISchema, FlexSchema, FormSchema, GridSchema, HeaderBarSchema, HoverCardSchema, HtmlSchema, IconSchema, ImageSchema, InputOTPSchema, InputSchema, KanbanSchema, KbdSchema, LabelSchema, ListSchema, ListViewSchema, LoadingSchema, MarkdownSchema, MenubarSchema, NavigationMenuSchema, ObjectCalendarSchema, ObjectChartSchema, ObjectFormSchema, ObjectGanttSchema, ObjectGridSchema, ObjectKanbanSchema, ObjectMapSchema, ObjectViewSchema, PageNodeSchema, PaginationSchema, PopoverSchema, ProgressSchema, RadioGroupSchema, ReportBuilderSchema, ReportComponentSchema, ReportViewerSchema, ResizableSchema, ScrollAreaSchema, SelectSchema, SeparatorSchema, SheetSchema, SidebarSchema, SkeletonSchema, SliderSchema, SonnerSchema, SortUISchema, SpinnerSchema, StackSchema, StatisticSchema, SwitchSchema, TableSchema, TabsSchema, TextSchema, TextSpanSchema, TextareaSchema, TimelineSchema, ToastSchema, ToasterSchema, ToggleGroupSchema, ToggleSchema, TooltipSchema, TreeViewSchema, ViewSwitcherSchema

That is 103 names; two members resolve to unnamed inline shapes and are reported by their
union position (`#70`, `#84`), for 105.

---

## Q1: fidelity

### The census

| result | count |
| --- | --- |
| converts under **default (strict)** options | **0 / 105** |
| converts under **lenient** options | **105 / 105** |
| **faithful** — converted with nothing lost | **0 / 105** |
| **degraded** — converted, constraint lost | **105 / 105** |
| **failed** — cannot convert at all | 0 / 105 (lenient) · 105 / 105 (strict) |

The strict leg fails on every single node type, all 105 with the identical first cause:

```
Undefined cannot be represented in JSON Schema        (105x)
```

`z.undefined()` is an arm of `SchemaNodeSchema`'s union (`base.zod.ts:58`), which
`BaseSchema.body` / `.children` reference — so it is reachable from every node.

### What is actually lost, and it is not what was predicted

The card's named risk was `lazySchema` / refine / effects converting to `{}`. Measured
per construct, in `packages/types/src/zod/`:

| construct | sites | strict leg | lenient leg | verdict |
| --- | --- | --- | --- | --- |
| `z.lazy(` | 13 | converts | converts | **faithful — risk falsified** |
| `.refine(` | 2 | converts | converts | **predicate silently dropped** |
| `.superRefine(` | 3 | converts | converts | **predicate silently dropped** |
| `.transform(` | 0 | — | — | not present |
| `z.function(` | 60 | throws | `{}` | **accepts anything** |
| `z.undefined(` | 1 | throws | `{}` | blocks the whole strict leg |
| `z.any(` | 71 | `{}` | `{}` | accepts anything |
| `z.unknown(` | 10 | `{}` | `{}` | accepts anything |
| `z.custom(` | 0 | — | — | not present |
| `.passthrough(` | 14 hits, **5 real calls** | `additionalProperties` → `{}` | same | **opens the object** |
| `.strict(` | 3 hits, **0 real calls** | — | — | nothing closes anything |

`z.lazy` converting cleanly is a genuine and useful negative result — recursion was the
loudest predicted risk and it is not a risk here. The `lazySchema` named in the card is a
**`@objectstack/spec` helper**, not a zod primitive; the spec shapes that flow into these
mirrors by reference carry it, and they convert too.

**The dangerous construct is `.refine` / `.superRefine`.** They neither throw nor emit
`{}`. They convert to a structurally complete, healthy-looking object with the predicate
simply **gone**. **All five** predicate sites in the mirrors were isolated, each with a
control that passes:

```
base.zod.ts:272     ComponentInputSchema "Input control type arms must be distinct"
   CONTROL  (predicate satisfied) zod=accept jsonschema=accept   control OK
   PROBE    (predicate violated)  zod=REJECT jsonschema=accept   <== PREDICATE SILENTLY DROPPED

app.zod.ts:99       NavigationItemSchema "`label` is required"
   CONTROL  (predicate satisfied) zod=accept jsonschema=accept   control OK
   PROBE    (predicate violated)  zod=REJECT jsonschema=accept   <== PREDICATE SILENTLY DROPPED

form.zod.ts:596     FormFieldSchema "UNRESOLVABLE_FIELD_WIDGET_NAMESPACE"
   CONTROL  (predicate satisfied) zod=accept jsonschema=accept   control OK
   PROBE    (predicate violated)  zod=REJECT jsonschema=accept   <== PREDICATE SILENTLY DROPPED

objectql.zod.ts:258 UserFilterTabSchema "tab requires a name" (probed via ListViewSchema)
   CONTROL  (predicate satisfied) zod=accept jsonschema=accept   control OK
   PROBE    (predicate violated)  zod=REJECT jsonschema=accept   <== PREDICATE SILENTLY DROPPED

complex.zod.ts:481  GlobalFilterSchema -> delegated spec date-`defaultValue` refinement
   CONTROL  (date + ISO defaultValue)     zod=accept jsonschema=accept   control OK
   PROBE    (date + unresolvable value)   zod=REJECT jsonschema=accept   <== PREDICATE SILENTLY DROPPED
```

| site | what stops being enforced |
| --- | --- |
| `base.zod.ts:272` | `ComponentInput.type` union arms must be distinct |
| `app.zod.ts:99` | `id` and `label` required on every non-separator navigation item |
| `complex.zod.ts:481` | the spec's `type: 'date'` `defaultValue` vocabulary (preset / ISO date / macro token) |
| `form.zod.ts:596` | field-widget namespace must be resolvable (`UNRESOLVABLE_FIELD_WIDGET_NAMESPACE`) |
| `objectql.zod.ts:258` | `tab requires a name` (`name` or `id` must be present) |

**5 of 5 measured, none inferred.**

### The degraded shapes, named

**All 105 are degraded, and for the same reason: openness.** Every one descends from
`BaseSchema`, which is `.passthrough()` (`base.zod.ts:197`), so every one projects with
`additionalProperties` pointing at an accept-anything schema.

Across the whole artifact: **276 of 333 objects are open**, and only **8 of 3,967
properties** are vacuous `{}`. So the loss is overwhelmingly *openness*, not empty
property projections — the opposite of what the card's phrasing anticipated.

The 8 vacuous properties, attributed to the leaf that carries them:

| shape | vacuous property |
| --- | --- |
| `DataTableSchema` | `visibleWhen`, `disabledWhen` (on two nested column shapes — 4 total) |
| `DashboardComponentSchema` | `filter` |
| `FilterBuilderSchema` | `items/value` |
| `FilterUISchema` | `items/value` |
| `ListViewSchema` | `items/anyOf/0/value` |

---

## Q2: size

Not estimated — generated and measured.

| | bytes |
| --- | --- |
| artifact, pretty (2-space) | **651,908** |
| artifact, minified | **369,028** |
| artifact, gzipped (minified) | **55,529** |
| `packages/types/dist` (the published payload) | 3,029,129 |
| — of which `.d.ts` | 2,730,922 |
| — of which `.js` | 298,207 |
| `packages/vscode-extension/schemas/objectui-schema.json` (today's stub) | 2,723 |

`@object-ui/types` publishes `files: ["dist", "README.md", "CHANGELOG.md", "LICENSE"]`.
Adding the artifact to `dist` grows the published payload by **+21.5 %** (pretty) or
**+12.2 %** (minified). It would be, by a wide margin, the largest single file in the
package — 1.2× the size of all the emitted JavaScript combined at minified size, 2.2× at
pretty.

For scale, the artifact is **239×** the size of the vscode stub it would replace, which
is the card's own point that 2,723 bytes cannot be describing this vocabulary.

### The precedent nobody costed: `@objectstack/spec` already ships one

`@object-ui/types` depends on `@objectstack/spec`, and that package **already publishes
generated JSON Schema** — `json-schema/` is in its `files` array:

```
node_modules/@objectstack/spec/json-schema/            23,385,697 bytes
  objectstack.json (one combined document)             12,302,857 bytes
  ui/  (156 per-shape documents)                        1,830,601 bytes
```

Two things follow, and they cut in opposite directions.

1. **The maintenance shape is not novel.** A generate-and-publish JSON Schema pipeline
   already exists in this ecosystem, at 36× the byte cost being debated here. "A
   generated artifact is a maintained artifact" is a real cost, but it is one the
   platform has already accepted once.
2. **It does not already cover this contract.** The spec's `ui/` documents describe
   spec-level UI concepts (`App.json`, `Dashboard.json`, `ChartConfig.json`). There is no
   `Button.json`, `Flex.json`, `Card.json`, `Table.json` or `Form.json` — the ObjectUI
   **node vocabulary** is absent. This card is not a duplicate of it.

And the contrast is the measurement that matters most:

| | closed at the root | source |
| --- | --- | --- |
| `@objectstack/spec` `json-schema/ui/*.json` | **118 / 124** object-rooted documents | `strictObject(...)` |
| ObjectUI `AnyComponentSchema` projection | **0 / 105** node types | `BaseSchema.passthrough()` |

Same class of pipeline, same dialect, opposite closedness — because the sources differ.
That is the cleanest available evidence that the artifact's permissiveness is inherited
from the zod source, not caused by the converter.

---

## Q3: the objectui#5127 judgement surface

The card flags this as *"inference, not measurement"*. Measured.

### The corpus split, reproduced

Applying `check.ts`'s own `OBJECTUI_STRUCTURAL_KEYS` rule to every `.json` file in the
repo (excluding `node_modules`, `dist`, `.git`):

```
.json files scanned              : 620
files with a root string "type"  : 475
  JUDGED  (carry a structural key): 166
  SKIPPED (no structural key)     : 309   = 65.1 %
```

The card cites 258 files / 60.8 % on an earlier base. Of the 309 skipped here, **45 are
`package.json`** (`"type": "module"`); 309 − 45 = **264**, adjacent to 258 on a tree that
has moved five days. The populations agree.

**Census-completeness control.** 69 of the 620 files fail `JSON.parse` — `check.ts` reads
them with `jsonc-parser` and this instrument did not. Re-reading exactly those 69 with
`jsonc-parser@3.3.1` finds **0** with a root string `type`, so the 475 is complete against
`check.ts`'s own reader and no file was lost to the stricter parser.

### Would a generated artifact give them a judgement surface?

The only route is to use the artifact as the **recogniser** — judge a file when it
validates. Measured over the 309 skipped files:

| | artifact | `safeValidateSchema` (today, no new artifact) |
| --- | --- | --- |
| skipped files accepted | **223** | **209** |
| skipped files rejected | 86 | 100 |
| `package.json` files correctly refused | **45 / 45** | **45 / 45** |
| false accepts (zod rejects, it accepts) | **14** | 0 |

So the honest answer is:

1. **Yes, ~209 of the 309 files can be brought back into judgement** — that is a real
   answer to objectui#5127's recall debt, and it is worth having.
2. **No, the generated artifact is not what delivers it.** `safeValidateSchema` delivers
   the same thing today, refuses the same 45 `package.json` files, and additionally
   refuses the 14 that the artifact wrongly accepts. The artifact is strictly the worse
   recogniser of the two.
3. Neither recogniser re-creates objectui#5127's original defect — the `package.json`
   false-positive class stays at zero, because `type: "module"` matches no `const` in the
   union.

**The caveat that matters**, and it applies to both: a validity-based recogniser
conflates *"this file is foreign"* with *"this file is a broken ObjectUI schema"*. Real
schema files in the skipped set that fail validation today would all be filed under "not
ObjectUI" rather than reported as invalid. That is a design question for objectui#6075,
not a blocker — but it is not free.

### Full-corpus agreement

Over all 475 root-`type` files:

```
zod and artifact AGREE : 461/475  (97.1%)
artifact ACCEPTS where zod REJECTS (WEAKER)  : 14
artifact REJECTS where zod ACCEPTS (STRICTER): 0
```

**Zero cases where the artifact is stricter.** Lossy conversion can only widen, and it
did: the artifact is a strict relaxation of the source.

The 14 are all the same defect — `z.function()` projecting to `{}`. All 14 sit in
`examples/schema-catalog/src/schemas/components-feedback-toast/` and
`components-feedback-sonner/`. Example:

```json
{"type":"button","label":"Destructive Toast","variant":"destructive",
 "onClick":{"action":"toast","variant":"destructive","title":"Error",
            "description":"Something went wrong."}}
```

```
zod      : REJECT — { code: "invalid_type", expected: "function", path: ["onClick"] }
artifact : accept
```

That those files exist at all is a separate defect, filed as **objectui#6124**: 28 mirror
keys are declared `z.function()`, which no JSON document can satisfy, and 14 corpus files
author them.

---

## The `[key: string]: any` projection — what it does to closedness

This is the trap the card named as decisive, and it is confirmed as a **first-class
result**, not a footnote.

`BaseSchema` ends `.passthrough()` (`base.zod.ts:197`, comment: *"Allow additional
properties for type-specific extensions"*). Projected, with controls in the same run:

```
z.strictObject          -> additionalProperties = false
z.object().passthrough  -> additionalProperties = {}          <- accepts anything
z.object (plain)        -> additionalProperties = undefined   <- also accepts anything
```

Every one of the 105 node types extends `BaseSchema`, so every one inherits it. In the
mirrors, `.strict()` is called **zero** times — the three grep hits are all prose in
comments. Nothing anywhere closes a node. On `ButtonSchema` the projection is
`additionalProperties: {"$ref": "#/$defs/__schema42"}`, and that `$def` resolves to the
empty schema `{}`.

Isolated on `ButtonSchema`:

| input | zod | artifact |
| --- | --- | --- |
| `{type:'button', label:'x'}` | accept | accept |
| `+ thisKeyIsNotDeclaredAnywhere: {...}` | accept | accept |
| `+ classNmae: 'p-4'` (misspelling of `className`) | accept | accept |

**A misspelled real key is accepted by both.** This is the exact AI-authoring failure the
card's axis ③ is about: an agent that writes `classNmae` gets a green light from the
schema, and the styling silently never applies.

⇒ **The card's stated hypothesis is confirmed: a generated JSON Schema buys no rejection
that `.strict()` has not already bought — and `.strict()` has bought none.** The artifact
would carry `properties`, `required`, and a `const` on every `type`, which *reads* as a
closed contract, while accepting arbitrary undeclared keys on all 105 node types. That is
the "looks closed and is not" hazard, measured rather than predicted.

The one thing the artifact does close: an **unknown `type` value** is refused, because
each leaf carries `{"type":"string","const":"button"}`. But `AnyComponentSchema` refuses
it too, so this is not a gain over today either.

---

## What the measurement points to

The fork is the maintainer's. What the numbers support:

### A — ship a generated JSON Schema from `@object-ui/types`: **not supported today**

Against it, all measured:

- It is a **strict relaxation** of the zod source (0/475 stricter, 14/475 weaker). It adds
  no rejection anywhere.
- It costs **+12–22 %** of the published package, plus a permanent generator, a drift gate
  and a build slot.
- It publishes a **second description** of the contract into the objectui#4972 /
  objectui#4605 family, and this one is guaranteed to disagree with the first — the
  divergence is not a risk, it is measured at 14 files.
- It hands AI authors a document that reads closed and is open on every node type.

The honest form of this result is the one the dispatch anticipated: **A is not worth
having until objectui#5155 moves.** If `BaseSchema` were closed, the artifact would
project `additionalProperties: false` and the calculation changes completely — the five
dropped predicates would then be the only remaining gap, and five predicates over 105 node
types is a defensible loss. The sibling comparison is the proof: `@objectstack/spec` runs
the same class of pipeline over a `strictObject` source and gets 118/124 closed documents.
The blocker is the source's permissiveness, not the converter.

### B — do not ship; keep zod source + `objectui check`: **what the numbers support**

`safeValidateSchema` already delivers everything the artifact would, strictly better
(97.1 % agreement, never worse, better on 14). It is version-correct by construction,
costs zero bytes, and cannot drift from itself.

There is a concrete, zero-cost improvement available inside B, and it does not need this
card's artifact: **objectui#6075's recall debt can be repaid by using `safeValidateSchema`
as the recogniser**, which admits ~209 of the 309 skipped files and refuses all 45
`package.json`. That would unblock objectui#6075 from objectui#5392 entirely. (Subject to
the foreign-vs-invalid caveat above — that is objectui#6075's design question to answer.)

### C — vscode-extension-only: **defensible, on an axis this measurement does not damage**

Worth stating precisely, because it is easy to read the fidelity numbers as killing C too,
and they do not. **C's value is completion, not rejection.** An editor offering key names,
enum arms and `description` hover text needs *suggestions*, and every degradation measured
here — openness, dropped predicates, `{}` handlers — leaves suggestions intact. The
2,723-byte stub covers essentially none of a ~200-type vocabulary; a 369 KB generated
document would cover it. C also carries no publish obligation, so the drift gate is
cheaper and a stale artifact misleads an editor rather than a contract.

C's cost is that it is a generated artifact all the same, and the axis ③ hazard partly
survives: an editor that accepts `classNmae` without complaint still teaches the wrong
thing. It just teaches it to a human in an editor rather than to an agent reading a
published contract.

---

## What this measurement cannot see

Stated because the card's own confidence gap is the model for this section.

1. **It measures the zod mirrors, not the contract.** The mirrors are one of two
   descriptions; the TypeScript interfaces are the other, and they are *already known to
   disagree* (objectui#5927, objectui#5853, objectui#6058, and the unmirrored ledgers
   landed by objectui#6149 / objectui#6152). A generated artifact would inherit the
   **mirror's** view of the contract, including every one of those disagreements. This
   audit did not adjudicate any of them.
2. **In-repo corpus only.** 475 files in this repository. What consumers author against
   published `@object-ui/types` on npm is invisible, and the corpus here is heavily
   weighted toward `examples/schema-catalog`.
3. **One validator, and it silently ignores one keyword.** Accept/reject was measured with
   **ajv 8.20.0** in draft-2020-12 mode with `strict: false`, and ajv reported
   `unknown format "uri" ignored in schema at path "#/$defs/__schema69"` — `.url()`
   projects to `format: "uri"`, which ajv does not enforce without `ajv-formats`. So the
   artifact is *even weaker in practice* than its own text, by an amount this run did not
   quantify. VS Code's own JSON Schema engine, and other validators, also differ on
   `$ref`/`$defs` cycle handling and on `anyOf` error reporting.
4. **Completion quality is asserted, not measured.** The C recommendation rests on
   suggestions surviving the losses, which is structural reasoning. Nobody drove an
   editor against the artifact. The `description` strings survive into the output, but
   whether they are *good enough to author from* was not assessed.
5. **Runtime is out of frame.** The renderer may accept or reject things that neither
   zod nor the artifact do. Validation agreement is not rendering agreement.
6. **`io: 'input'` only.** The lenient leg converts the input side. A generator might
   reasonably want the output side, which differs wherever defaults or coercion appear.
7. **Degraded is measured as a property of the projection, not of author intent.** A node
   is counted degraded because its projection is open or a constraint is provably gone.
   Whether any given author would ever hit that gap is not measured.

## Base, and the #6117 delta

Measured on `12dcdc110` — the measurement branch merged up to `origin/main` @
`50d0d6cc5`, which **contains** objectui#6117 (`105f3c55c`, "retire `CRUDSchema` and the
`crud` node type"). The census therefore excludes `CRUDSchema`.

The delta from #6117 landed exactly as one node type, and it moved a second number that a
pre-#6117 estimate got wrong:

| | pre-#6117 | on `12dcdc110` |
| --- | --- | --- |
| `AnyComponentSchema` union members | 14 | **14 (unchanged)** |
| leaf node schemas | 106 | **105** |

`CRUDComponentSchema` — the CRUD *family* union — is still a member of
`AnyComponentSchema`; what #6117 removed is the `CRUDSchema` **leaf** inside it.
`CRUDDialogSchema`, `DetailSchema` and `ActionSchema` all stay. A pre-#6117 projection
that predicted the union dropping to 13 members was wrong about the mechanism, and is
corrected here.

**No conclusion in this audit depends on #6117**: the fidelity ratios (0/105 faithful,
0 stricter, all nodes open) are properties of `BaseSchema`, which #6117 does not touch.

## Reproducing

The measurement script is deliberately **not committed** — it is a throwaway instrument,
not a generator, and committing it would be the thing this card is not ruled to do. Every
number above is reproducible from these commands.

```bash
# build first — a stale dist/*.d.ts lies in both directions
pnpm --filter @object-ui/types build

# converter identity
node -p "require('./packages/types/node_modules/zod/package.json').version"   # 4.4.3

# construct census — use grep -F; an unescaped '(' in an ERE silently matches nothing
cd packages/types/src/zod
grep -oF 'z.function('   *.ts | wc -l   # 60
grep -oF '.superRefine(' *.ts | wc -l   # 3
grep -oF '.refine('      *.ts | wc -l   # 2
grep -oF 'z.lazy('       *.ts | wc -l   # 13
grep -oF 'z.any('        *.ts | wc -l   # 71
grep -oF 'z.unknown('    *.ts | wc -l   # 10
grep -oF '.passthrough(' *.ts | wc -l   # 14 hits, 5 real calls (grep -nF to separate prose)
grep -oF '.strict('      *.ts | wc -l   # 3 hits, 0 real calls
grep -oF 'z.string('     *.ts | wc -l   # 689 — positive control
grep -oF 'z.object('     *.ts | wc -l   # 117 — positive control
grep -oF 'z.bigint('     *.ts | wc -l   # 0   — negative control
grep -oF 'z.symbol('     *.ts | wc -l   # 0   — negative control
grep -oF '.transform('   *.ts | wc -l   # 0   — negative control
grep -oF 'z.custom('     *.ts | wc -l   # 0   — negative control

# spec's own shipped artifact, for the closedness contrast
ls node_modules/@objectstack/spec/json-schema/ui/*.json | wc -l          # 156
du -sb node_modules/@objectstack/spec/json-schema                        # 23,385,697

# conversion, size, corpus agreement
#   z.toJSONSchema(AnyComponentSchema, { unrepresentable:'any', cycles:'ref',
#                                        reused:'ref', io:'input' })
#   validated with ajv 8.20.0 (dist/2020.js), strict:false
#   corpus rule copied verbatim from packages/cli/src/commands/check.ts
```

### A note on the instrument

Every zero in this audit sits in a table beside a non-zero produced by the identical
method, and every accept/reject probe is paired with a control that produces the opposite
verdict:

- construct census: `z.bigint(` = 0 and `z.symbol(` = 0 next to `z.string(` = 689 and
  `z.object(` = 117, all from the same `grep -oF` run;
- corpus recogniser: `{type:'button',label:'Send'}` → both accept, `{type:'module'}` →
  both reject, so the instrument demonstrably emits both verdicts;
- structural-key rule: injecting `className` into a skipped file flips it to JUDGED, and
  removing it flips it back;
- predicate probes: five sites, five controls, all five controls accept on both legs
  before the probe is read;
- closedness: `z.strictObject` → `additionalProperties: false` in the same run in which
  every ObjectUI node projects open, so "open" is not an artefact of the converter call.

A prior run of the construct census returned **0 for every parenthesised pattern**,
including `z.lazy(`, which `base.zod.ts:51` visibly contains. The cause was an unescaped
`(` in `grep -oE`, opening an unterminated group; `2>/dev/null` hid the error and the
zeros read as findings. It was caught by the control — the same run's escaped
`z\.string\(` returned a large number while `z.object(` returned 0, which cannot both be
true. This is recorded rather than quietly fixed because it is the failure mode this card
was explicitly warned about, and it fired on the first attempt.
