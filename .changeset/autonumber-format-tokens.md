---
"@objectstack/spec": minor
"@objectstack/objectql": minor
"@objectstack/driver-sql": minor
"@objectstack/cli": minor
---

feat(autonumber): date, {field} and per-scope counter reset for autonumber formats

`autonumberFormat` previously only understood a single `{0000}` sequence slot —
everything else was a fixed literal prefix on one global counter. Real MES/eHR
record numbers need three more token classes, so the format is now tokenized by a
shared pure renderer in `@objectstack/spec` (`parseAutonumberFormat` /
`renderAutonumber`) that the engine fallback and the SQL driver both call, so they
emit byte-identical numbers (#1603 parity):

- **Date tokens** — `{YYYY}` `{YY}` `{MM}` `{DD}` `{YYYYMMDD}` resolve the calendar
  day in the request's **business timezone** (`ExecutionContext.timezone`, ADR-0053;
  UTC fallback), threaded through the new `DriverOptions.timezone`.
- **`{field}` interpolation** — `{section}{island_zone}{000}` substitutes record
  field values into the prefix.
- **Per-scope counter reset** — the counter's scope is the rendered prefix *before*
  the sequence slot, so `AD{YYYYMMDD}{0000}` resets daily, `{section}{island_zone}{000}`
  numbers per group, and `{plan_no}{000}` numbers per parent — all from one
  mechanism, no separate reset config.

Fixed-prefix formats like `CASE-{0000}` render an empty scope and keep their single
global counter, so existing sequences are unchanged. The persistent
`_objectstack_sequences` table gains a `scope` column (PK widened to
`object, tenant_id, field, scope`); deployments with the legacy 3-column table are
migrated in place on first use, carrying existing counters to `scope=''`.

Guardrails against the `{field}` footguns:

- **Empty interpolated field is a hard error, not a silent mis-number.** A
  `{field}` token whose value is missing at create time would render to an empty
  prefix and collapse the record into the wrong counter scope. Both the SQL driver
  and the engine fallback now refuse to generate and throw a clear error naming the
  empty field (shared `missingFieldValues` helper).
- **Build-time lint (`@objectstack/cli compile`).** `autonumber` formats are
  checked against the object's fields: a `{field}` token naming a non-existent
  field (or the autonumber field itself) **fails the build**; a token naming an
  *optional* field emits an advisory warning to mark it `required: true`.
- **Legacy sequence-table migration fails safe.** If the legacy table's primary
  key cannot be widened to include `scope`, fixed-prefix sequences keep working and
  a per-scope write raises an actionable error instead of an opaque DB primary-key
  violation at insert time.
