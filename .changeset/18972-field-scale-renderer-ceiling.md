---
'@objectstack/spec': minor
---

fix(spec)!: `scale` is bounded at the renderer ceiling of 100 (#18972)

Clause-②: no (narrowing)

`FieldSchema.scale` — and the inline grid column's own `scale` — were declared as
any non-negative integer with no upper bound. Every renderer that turns a declared
`scale` into fraction digits reaches one of two platform primitives, and both of
them refuse above 100: `Number.prototype.toFixed` throws `RangeError: toFixed()
digits argument must be between 0 and 100`, and `Intl.NumberFormat` throws
`RangeError: maximumFractionDigits value is out of range.` So a spec-valid
declaration was unrenderable by any conforming consumer, and its author got no
signal at publish time — the failure arrived as a render-time crash in someone
else's repository. Both live readers are objectui's: the grid's `computeRow` rounds
a computed cell with `Number(v.toFixed(column.scale))`, and the number cell renderer
passes a field's `scale` straight into `maximumFractionDigits`.

Both declarations now carry an upper bound of 100, and the refusal says **why** —
it names both primitives, the `RangeError` and the legal maximum — so an author
reads a platform limit they can verify rather than a cap somebody chose. The bound
is the platform's own: at 100 both primitives are measured to succeed, at 101 both
are measured to throw, and a unit test re-measures that boundary on every run
rather than trusting the literal.

**BREAKING** — a declaration above 100 that parsed clean before is refused at
authoring now. This is a deliberate narrowing of a published accepted set, priced
as such rather than as a tidy-up. The declarations it refuses could only ever have
crashed a renderer: there is no value above 100 that any conforming consumer can
render, which is why the bound is the platform's limit and not a policy number.
`packages/objectql` already carries the consumer-side half of the same fact and
skips its formula rounding past 100, so no read is newly affected.

Unchanged in both directions: `scale: 100` still parses, `scale: 0` still parses,
absence is still absence, and the malformed-declaration refusals from #8321
(`scale: -1`, `scale: 2.5`) keep their existing codes and their existing wording.
`precision` is untouched — it is a total digit count that reaches neither
primitive, so the renderer-ceiling argument does not carry to it.

Shipped as `minor` under the repo's launch-window convention, in which
`check-changeset-no-major` refuses `major` and breaking-ness is carried by this
banner plus the ADR-0087 disposition rather than by the level.

<!-- adr-0087: not-required (no-migration-prescription) no authorable key is renamed, retired or reshaped: `scale` keeps its name, its place and its type, and what moves is the top of one existing key's accepted numeric range. So `objectstack migrate meta` has nothing to visit — there is no stored spelling to rewrite and no FROM side to map, because the values this now refuses have no correct mechanical replacement: 101 fraction digits is not a precision a renderer can honour at all, and picking the display precision an author actually meant is their judgement, not a transform the ledger can carry. A ledger row would therefore have to invent the very semantics ADR-0078 and PD #12 forbid inventing, and the channel that does reach every affected author is the parse refusal itself, which names both primitives, the `RangeError` and the legal maximum at the moment the declaration is written. Measured on this tree: 123 `scale:` declarations across `*.ts` / `*.tsx` / `*.json` / `*.mdx`, of which zero declare more than 100 — the lit control for a zero whose radius is this repository's tracked files and whose known outside is a `sys_metadata` row already stored in a running deployment, which no in-repo instrument reaches. The other four categories are closed on facts: `@objectstack/spec` publishes to npm and declares no `private` (not `unpublished`); no ADR-0087 id is minted in this diff (not `registered`) and none pre-dating the base covers it (not `already-registered`); and the surface that moves is a Zod metadata schema, not a runtime-only TS interface and not a type annotation (neither `runtime-interface-only` nor `type-surface-only`). -->
