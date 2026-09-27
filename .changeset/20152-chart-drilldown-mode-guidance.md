---
'@objectstack/spec': patch
---

`ChartDrillDownSchema`'s refusal text for `drillDown.mode` names the one objectui block that reads it, not all three it used to

An author (or an AI) who writes `drillDown.mode` on a chart gets this guidance
sentence back from `objectui validate` / `safeValidateSchema`. It used to read:

> `mode` (`'filter'` | `'record'`) is a TABLE / PIVOT / METRIC drill key, not a
> chart one: …

`object-metric` has refused `drillDown.mode` at its TypeScript door since
objectui#9002 (PR objectui#10681, merged, on the maintainer ruling recorded
there, comment `5643445104`), and `object-pivot` has refused it since
objectui#10685 (PR objectui#10710, merged). Measured on objectui `origin/main`:
neither block's renderer ever read `mode`; only `object-data-table` does. So
the old sentence sent an author who followed it straight into a second
refusal on two of the three blocks it named — right on `object-pivot` and
`object-metric` (both now refuse the key by name), and a stored JSON config
that carries it there is silently ignored with no diagnostic.

The sentence now names the one block that actually reads `mode`:

> `mode` (`'filter'` | `'record'`) is objectui's `object-data-table` drill
> key, not a chart one: …

The reasoning clause and "Delete the key" are unchanged. The neighbouring
`report` guidance entry (a METRIC / PIVOT widget capability) is untouched —
its blocks were not remeasured on this card.

⛔ No accept/reject behaviour changes. `mode` remains refused on
`ChartDrillDownSchema` exactly as before; only the refusal text changes.

**This is shipped, which is why it carries a changeset rather than
`skip-changeset`.** `@objectstack/spec`'s published `files[]` ships both
`dist` and `src/**/*.zod.ts`, and `chart.zod.ts` is one of the latter — so the
sentence ships as source verbatim, and also as a runtime string built into
`dist/ui/index.js` / `dist/ui/index.mjs` (measured: present at 1 occurrence
each after a rebuild, with the old "TABLE / PIVOT / METRIC" spelling absent
from both).
