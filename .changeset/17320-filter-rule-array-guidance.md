---
'@objectstack/spec': patch
---

The seven converged rule-array `filter` doors name the ViewFilterRule array form when they refuse the record form

Seven `filter` doors converged on `z.array(ViewFilterRuleSchema)` in the
objectui#6206 family — `ElementDataSourceSchema.filter` (`ui/page.zod.ts`) and
the `object-grid` / `object-metric` / `object-kanban` / `object-calendar` /
`element:number` / `element:record_picker` rows of `ComponentPropsMap`
(`ui/component.zod.ts`). Each previously accepted the MongoDB-style record
(`{ status: 'active' }`), and each now refuses it — measured on the built
artifact, with exactly one issue apiece: `invalid_type` at `filter`, *"Invalid
input: expected array, received object"*, and nothing else.

The prescription for that transition was already written down twice, in two
places a parse never reaches: every one of the seven `.describe()` strings, and
in full in the three `18.*-filter-rule-array` semantic migration entries.
Nothing bridges `.describe()` into a zod issue and this package installs no
global error map, so the one population whose metadata the convergence broke —
the authors, human and AI, who wrote the previously-legal form — received the
single sentence that does not say what to write instead.

Each of the seven now answers that value with the new spelling, through the
zod-v4 `{ error }` param this package already uses for targeted guidance
(`shared/expression.zod.ts`, `ui/view.zod.ts`, `shared/strict-object.ts`):

> `filter` on this `object-grid` takes the ViewFilterRule ARRAY form
> `[{ field, operator, value }, ...]`, and this value is the MongoDB-style
> record form this door took before the one-filter-orthography convergence.
> Write one rule per record key — they AND — so this filter becomes
> `[{ field: 'status', operator: 'equals', value: 'active' }]`. Legacy operator
> shorthands (`eq`, `gt`, `notIn`, …) are accepted and normalized on parse.
> Full conversion table: migration
> `element-data-source-and-object-block-filter-rule-array`.

Following `strictObject`'s model rather than transcribing a sentence seven
times: the rule shape is read from `ViewFilterRuleSchema`'s own shape, the
canonical operator is `normalizeFilterOperator('eq')` — the same fold the door
itself runs — and the worked rewrite is computed from the author's own record,
so the example names their fields. A pin holds each door's `migration` id equal
to a real registry entry and each door's `surface` equal to the one its own
`strictObject` declaration registered.

⛔ No accept set moves. The doors refuse exactly the shapes they refused
before, the generated `json-schema/` and `authorable-surface` artifacts are
byte-identical after the change, and the map returns `undefined` for everything
that is not a plain record — so an array author's element-level issues
(`filter.0: Invalid option: expected one of "equals"|…`) and a non-record value
(*"expected array, received string"*) still arrive in zod's own words.

**Shipped, which is why it carries a changeset rather than `skip-changeset`.**
Measured on the built artifact after both tsup passes finished: the new message
text is present in **18** published files of `npm pack --dry-run`'s 2012, the
test-only text is present in **0** (negative control), and a pre-existing
shipped string reaches **62** as the lit control proving the scan reaches.
`src/ui/page.zod.ts` and `src/ui/component.zod.ts` are also shipped as source
by `files[]`'s `src/**/*.zod.ts`.
