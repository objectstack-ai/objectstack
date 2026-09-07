---
"@objectstack/spec": patch
---

`DatasetMeasureSchema.format` now documents what a DATE-valued measure can and cannot say, and the numeral-pattern examples no longer stand as the whole story.

The field was silent about date measures while advertising `e.g. "$0,0.00", "0.0%"` — the pattern grammar a date measure is precisely unable to read. An author with a `min` / `max` over a date field read that line, wrote `format: 'YYYY-MM-DD'`, parsed clean, and got the locale default.

The statement is carried by a `.describe()` where there was none, so it reaches the published surfaces an author actually reads: the generated JSON Schema (`json-schema/ui/Dataset.json`, `DatasetMeasure.json`) and the reference table in `content/docs/references/ui/dataset.mdx`, whose Description cell for `format` had been rendering the silence as a blank. The docblock above it carries the longer measured record.

What it now says, measured rather than assumed against the objectui pin this repo builds against: a numeral pattern applies to a numeric measure; a date-valued measure never reads a date PATTERN — a date-only value reads `format` as a display STYLE (`short`, `relative`), and a datetime value ignores `format` altogether.

Nothing accepts or rejects differently: `format` remains `z.string().optional()` and no measure is refused. Documentation over a published schema (objectui#7178 ruled A).
