---
"@objectstack/spec": patch
---

`colorField` now documents what it means: a field to DERIVE a colour from, not a field holding one.

`TimelineConfigSchema`, `CalendarConfigSchema` and `GanttConfigSchema` each declare a `colorField`, and all three `.describe()` strings said only that the field "determines"/"drives" the colour — `'Field to determine item color'`, `'Field whose value determines the event color'`, `'Field that drives the bar color'`. Read literally, that invites pointing the key at a field whose stored value *is* a colour, which is the one case the renderers need the least: the common author intent is `colorField: 'status'`, a select field whose options already carry the colours.

The renderers resolve it as a derivation ladder (objectui#7243, shared as `createFieldColorResolver` in `@object-ui/core`):

1. the option `color` the field declares for the record's stored value;
2. else the value itself, when it already is a colour literal (hex 3/6/8-digit, `rgb(...)`, `hsl(...)`);
3. else each renderer's own last rung — the gantt derives a semantic colour token, the calendar hashes onto its theme-aware palette, the timeline draws its default marker.

The three strings now say that, each naming its own last rung. **Nothing in the accept set moves**: all three keys stay `z.string().optional()`, and a config pointing `colorField` at a plain hex field is still exactly as valid as before — that is rung 2. This is prose on a declared key, so the only regenerated follower is `content/docs/references/ui/view.mdx`.
