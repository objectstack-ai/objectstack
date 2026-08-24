---
"@objectstack/spec": minor
---

feat(spec): refuse an authored `radio` + `multiple: true` at the schema layer (#11437, maintainer ruling 2026-08-22 on objectui#4015, Option C)

**BREAKING** accept-set narrowing, shipped as `minor` under the repo's
launch-window convention for breaking changes.

An author could declare `{ type: 'radio', multiple: true }` and the producer
honoured it everywhere the widget could not: the data layer stored an array,
validated it as multi, split it on import and inferred multi arity for action
params, while the one renderer `radio` has draws a single-value radio group
with zero diagnostics. Declared multi, rendered single — the contradiction sat
inside `packages/spec` itself, where `SINGLE_OPTION_TYPES` calls `radio`
single-choice on one line and `MULTI_CAPABLE_TYPES` carries it on another
because it "shares the select branch".

Per the maintainer ruling recorded 2026-08-22 on objectui#4015 (Option C,
「接受所有」), `FieldSchema` now refuses the authored combination at parse
time — the seam every publish crosses, both for a standalone `field` document
and for fields embedded in an `ObjectSchema` — with a diagnostic that names
the field, names the illegal pair, and prescribes the correctly-named
multi-choice types: `checkboxes` (all options visible, radio-like layout),
`multiselect` (dropdown) and `tags` (free-form values).

**What stays accepted, byte-identically:** `radio` without `multiple`
(including its materialized `multiple: false`), `radio` with an authored
`multiple: false`, `select`/`lookup`/`user`/`file`/`image` with
`multiple: true`, and the inherently-multi types with or without the redundant
flag. Because `multiple` materializes `.default(false)`, the refusal can only
ever fire on an authored `true` — a defaulted value never trips it, and
`parse(parse(x))` stays stable (pinned).

**What is deliberately untouched, per the same ruling:** `MULTI_CAPABLE_TYPES`
and `isMultiValueField` in `field-value.zod.ts` keep `radio`, so data at rest
that was written under the old contract keeps its read path and no
stored-shape migration is paid — that is the whole reason Option C was
preferred over narrowing the sets themselves. A test pins `radio`'s membership
so a future cleanup trips loudly. `packages/objectql`'s record-validator
select/radio branch likewise stays, as a data-safety fallback for stock.

Measured before landing (both repos, examples/docs/fixtures/tests included):
21 `type: 'radio'` declarations, none carrying `multiple: true` — the refused
combination has zero occurrences, so no existing metadata is invalidated. The
ruling attaches an explicit flip condition: if deployed tenant metadata
carrying the combination with stored data is ever found, entrance rejection
alone would strand it and the set-narrowing option becomes required.

<!-- adr-0087: not-required (no-migration-prescription) The ruling explicitly declines a migration: at-rest data keeps its read path via the untouched MULTI_CAPABLE_TYPES / isMultiValueField, and re-measurement at the merge base found zero occurrences of the refused combination in either repo, so there is no existing author to migrate and nothing objectstack migrate meta is authorized to rewrite — a conversion rewriting the pair would itself be the stored-shape migration Option C was chosen to avoid. Guidance for future authors lives in the refusal diagnostic itself. -->
