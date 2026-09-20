---
'@objectstack/spec': minor
---

fix(spec)!: the form-row `scale` is bounded at the renderer ceiling of 100 (#19088)

Clause-②: no (narrowing)

`FormFieldBaseSchema.scale` — the per-field override a form row carries — was declared as
any non-negative integer with no upper bound. It is the third declaration of `scale` to
reach the same platform ceiling #18972 bounded on the two in `data/field.zod.ts`: every
renderer that turns a declared `scale` into fraction digits reaches one of two platform
primitives, and both refuse above 100. `Number.prototype.toFixed` throws `RangeError:
toFixed() digits argument must be between 0 and 100`, and `Intl.NumberFormat` throws
`RangeError: maximumFractionDigits value is out of range.` So a spec-valid declaration was
unrenderable by any conforming consumer, and its author got no signal at publish time —
the failure arrived as a render-time crash in someone else's repository. The route from
this row to that reader, measured in the sibling checkout at the `.objectui-sha` pin
`53ded82bf7`: plugin-form copies the row's constraint keys onto the runtime field
(`packages/plugin-form/src/sectionFields.ts:220`, `if (fd.scale != null) base.scale =
fd.scale;`), and the number cell renderer hands that value straight to `Intl.NumberFormat`
(`packages/fields/src/index.tsx:661-667`, `maximumFractionDigits: scale ?? 20`). That one
route carries the premise on its own.

The row now carries that upper bound, and the refusal says **why** — it names both
primitives, the `RangeError` and the legal maximum — so an author reads a platform limit
they can verify rather than a cap somebody chose. The bound is the platform's own: at 100
both primitives are measured to succeed, at 101 both are measured to throw, and a unit
test re-measures that boundary on every run rather than trusting the literal.

**BREAKING** — a form-row `scale` above 100 that parsed clean before is refused at
authoring now. This is a deliberate narrowing of a published accepted set, priced as such
rather than as a tidy-up. The declarations it refuses could only ever have crashed a
renderer: there is no value above 100 that any conforming consumer can render, which is
why the bound is the platform's limit and not a policy number.

Unchanged in both directions: `scale: 100` still parses, `scale: 0` still parses, absence
is still absence, and the malformed-declaration refusals from #8321/#12174 (`scale: -1`,
`scale: 2.5`) keep their existing codes and their existing wording. `precision` is
untouched on this row as on the object-field row — it is a total digit count that reaches
neither primitive, so the renderer-ceiling argument does not carry to it.

The number itself moves into `src/shared/scale-ceiling.ts`, a spec-internal leaf module
that no package entry re-exports, so no published export moves and `check:api-surface`,
`check:export-origins` and `check:declaration-map` all stay green. `data/field.zod.ts`
keeps the module-private copy #18972 minted; a pin asserts the two sites refuse with
byte-identical text, so the duplication is held equal rather than left to drift, and that
file can adopt the shared module later as a pure delete-and-import.

Shipped as `minor` under the repo's launch-window convention, in which
`check-changeset-no-major` refuses `major` and breaking-ness is carried by this banner
plus the ADR-0087 disposition rather than by the level.

<!-- adr-0087: not-required (no-migration-prescription) no authorable key is renamed, retired or reshaped: `scale` keeps its name, its place on the form row and its type, and what moves is the top of one existing key's accepted numeric range. So `objectstack migrate meta` has nothing to visit — there is no stored spelling to rewrite and no FROM side to map, because the values this now refuses have no correct mechanical replacement: 101 fraction digits is not a precision a renderer can honour at all, and picking the display precision an author actually meant is their judgement, not a transform the ledger can carry. A ledger row would therefore have to invent the very semantics ADR-0078 and PD #12 forbid inventing, and the channel that does reach every affected author is the parse refusal itself, which names both primitives, the `RangeError` and the legal maximum at the moment the declaration is written. Measured on this tree at `7e52288463`: 126 `scale: N` declarations across `*.ts` / `*.tsx` / `*.json` / `*.mdx` / `*.yml` / `*.yaml` as the lit control, of which four read above 100 and all four are refusal fixtures or prose about them (two from #18972's tests, two from this branch's) — zero authored declarations above the ceiling. The instrument's radius is this repository's tracked file contents; the known target outside it is a `sys_metadata` row already stored in a running deployment's database, which no in-repo instrument reaches, and #18972 recorded the same blind spot. The other four categories are closed on facts: `@objectstack/spec` publishes to npm and declares no `private` (not `unpublished`); no ADR-0087 id is minted in this diff (not `registered`) and none pre-dating the base covers it (not `already-registered`); and the surface that moves is a Zod metadata schema, not a runtime-only TS interface and not a type annotation (neither `runtime-interface-only` nor `type-surface-only`). -->
