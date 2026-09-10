---
"@objectstack/spec": patch
---

fix(spec): the date-range preset prescriptions now name a one-day window for the one-day presets (#17014)

`DATE_RANGE_PRESET_MACRO_WINDOWS` maps each dashboard date-range preset to the `{date-macro}` window a refusal PRESCRIBES to an author who wrote the preset name as a bare filter comparand (`bareDateRangePresetComparandMessage`). Two of its thirteen entries prescribed a window wider than the preset they name — a filter that parses, runs and returns rows over the wrong range, with no second error to correct against.

- **`yesterday`** was `['{yesterday}', '{today}']` — an end naming the day AFTER the window. The pair is written for `$between`, which is `$gte min` and `$lte max`, and a bare-day upper bound means "through that whole day", compiled half-open to `< nextUtcCalendarDay(max)` (ADR-0053 D-D). So the prescription resolved to `>= yesterday 00:00 AND < tomorrow 00:00`: yesterday **and** today. It is now `['{yesterday}', '{yesterday}']`.
- **`today`** was `['{today}', null]`, the open `$gte`-only arm, so the prescribed filter had no upper bound at all and also selected every day after today on a column carrying future dates. It is now `['{today}', '{today}']`.

Both entries now name their own last day, matching the convention the other eight closed entries already used and matching both executable mappings — objectui's `PRESET_RANGES` and `@objectstack/core`'s analytics date-range resolver, which independently spell `today` and `yesterday` as one-day windows.

The convention that decides an end token was nowhere written down, which is what let one table carry two readings. It is now stated as a rule on the table: **`start` names the window's first calendar day and `end` names its last, inclusive — never the day the window stops before**, and `end: null` is the open arm reserved for exactly the three rolling `last_N_days` windows. Tests pin the resolved extent of every window against a frozen reference day and require a stated extent for every declared preset, so a preset added later cannot silently pick the other reading.

No schema, type or export changes: the refused shapes and the vocabulary are exactly as before, and only the window text a refusal quotes back moves.
