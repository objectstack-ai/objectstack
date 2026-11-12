---
'@objectstack/lint': minor
'@objectstack/spec': minor
---

fix(lint)!: a stored computed field whose `expression` reads another record is refused at authoring (`stored-expression-cross-record-input`), and one that reads the clock, the acting user or a permission is warned (`stored-expression-volatile-input`) (#32529, #32554)

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: follow-up owed — skills/objectstack-data/rules/relationships.md (the line-item "Computed column" bullet teaches a stored `expression` and says nothing of an input read from another record, or of one that changes without a write: the clock, the acting user, a permission)

<!-- adr-0087: registered stored-expression-cross-record-input-refused -->

**BREAKING** accept-set narrowing in `os validate` / `os build` and at the object save door (`PUT /api/v1/meta/object/NAME`, package draft publish; Studio, REST and MCP authors).

- **Before.** A stored computed field (any field but a `formula` that declares an `expression`) could read another record through a reference, `hours: { type: 'number', expression: 'record.days * record.employee.daily_hours' }`. The engine computes it when the leave request is written and stores it; when the employee's `daily_hours` later changed, nothing computed the leave request again. Measured: the stored value stayed 40 where it should have been 30, every total over it drifted, and authoring said nothing.
- **Now.** The build and the save door refuse it with `stored-expression-cross-record-input` at `object 'OBJECT' · field 'FIELD' expression`; the message names each read (`record.employee.daily_hours`, the related object and the reference it goes through) and the three ways to write it. Counted: a read through a `lookup`, `master_detail`, `user` or `tree` field of the same object, by any spelling the engine resolves. Not counted: the reference itself and its `id`, which are the value the row stores; a read through a field that is not a reference.
- **Unchanged.** A `formula` field reading the same hop (computed on every read, so it never goes stale); a stored expression over the record's own fields; the parse, so an object stored before this release keeps loading, and its next save is judged.
- **Warned, not refused.** A stored expression that reads the clock (`now()`, `today()`, `daysFromNow()`, `daysAgo()`), the acting user (`current_user`, `user`, `ctx.user`, `os.user`) or a permission (`can()`, `hasCapability()`) gets a `stored-expression-volatile-input` warning at the build and an advisory at the save door: the stored value is the one of the moment of the write, where the same `expression` on a `formula` field is computed again on every read. The remedy it names: a `formula` field for the current value (not summable), or a scheduled flow that recomputes a stored value as time passes. `os.org` and `label()` are not counted.
- **`@objectstack/spec`** gains the upgrade-guide entry `stored-expression-cross-record-input-refused` (an ADR-0087 semantic migration in protocol 18's step: no automatic rewrite, because which of the three repairs the author meant is a judgement about the field).
- **`@objectstack/lint`** exports `STORED_EXPRESSION_CROSS_RECORD_INPUT` and `STORED_EXPRESSION_VOLATILE_INPUT`; `ExprIssue` gains an optional `rule` (absent, the finding is `expression-invalid`); `os explain stored-expression-cross-record-input` and `os explain stored-expression-volatile-input` print the reasoning.

**FROM → TO.** `hours: { type: 'number', expression: 'record.days * record.employee.daily_hours' }` → one of: `hours: { type: 'formula', returnType: 'number', expression: 'record.days * record.employee.daily_hours' }` (current on every read, not summable); a `summary` on the related object over this object's own stored values (`days`), with a `formula` there combining it with `daily_hours`; or a flow on the related object that writes the value onto the records pointing at it when it changes.
