---
'@objectstack/spec': minor
'@objectstack/lint': patch
'@objectstack/platform-objects': patch
---

fix(spec): a `joined` report draws no chart — `blocks[].chart` is removed and a container `chart` on a joined report is refused (#20161)

Clause-②: no (narrowing)

**BREAKING** — shipped as `minor` under the launch-window convention
(`check-changeset-no-major` refuses `major` until GA; breaking-ness is carried by
this banner, the `(narrowing)` arm above and the ADR-0087 disposition below,
never by the level).

A `joined` report draws each of its blocks as a table. The renderer's joined
branch returns before its one read of the report's `chart`, and nothing ever
read a block's `chart` at all. So a chart on a joined report, on the container
or on any block, parsed green, passed the `validate-chart-bindings` lint, and
plotted nothing. Both coordinates now answer at parse:

```
FROM  ReportSchema.safeParse({ name: 'overview', label: 'Overview', type: 'joined',
        chart: { type: 'bar', xAxis: 'status', yAxis: 'task_count' },
        blocks: [{ name: 'open_block', dataset: 'tasks', rows: ['status'], values: ['task_count'],
                   chart: { type: 'pie', xAxis: 'status', yAxis: 'task_count' } }] })
      -> { success: true }             // both charts silently never drawn

TO    -> { success: false, issues: [
           { code: 'unrecognized_keys', path: ['blocks', 0],
             message: '… `report.blocks[].chart` was removed in @objectstack/spec 17.5.0 (ADR-0049 enforce-or-remove) — … Delete the key. …' },
           { code: 'custom', path: ['chart'],
             message: 'a `joined` report draws no chart — it draws each block as a table and never reads `chart`, on the container or on a block. Delete `chart`; …' } ] }
```

**Fix.** Delete the `chart`. The report renders exactly as before, because
neither value was ever drawn. To plot one of the slices a block shows, give it a
non-joined report of its own with that `chart`.
`os migrate meta --from 17` lists the mechanical edits for existing sources.

**What does not change.** `chart` on a `tabular` / `summary` / `matrix` report is
untouched: it is that report's live embedded chart. A joined report with no
`chart` parses byte-identically to before, and a block keeps every other key.

### The retirement kit

- **Schema.** `JoinedReportBlockSchema` is closed (`strictObject`), so `chart` is
  removed from its shape and answered by its `guidance` table with the
  prescription (build-schemas check (c) proof 4). `ReportSchema.chart` stays
  declared; the joined arm of its refinement refuses it, beside the
  `dataset` / `rows` / `columns` / `values` / `order` refusals already there.
- **ADR-0087.** `RETIRED_KEYS_BY_MAJOR[18]` gains `ui/JoinedReportBlock:chart`, and
  the D2 conversion `report-joined-chart-removed` (protocol 18, retired from the
  load path) strips a block's `chart` and a joined container's `chart` from old
  sources and stored `sys_metadata` rows as a lossless delete. Stored rows can
  carry them: the Studio report form offered a block `chart` input until this
  change.
- **Form.** `reportForm` drops the block `chart` input and shows the container
  `chart` only when `type` is not `joined`; the `platform-objects` metadata-form
  translation bundles drop the `blocks.chart` label in all four locales.
- **Lint.** `validate-chart-bindings` no longer resolves the axes of a block chart
  or of a joined container's chart against a dataset: it would be vouching for a
  chart that is refused at parse and never drawn. A block's own `dataset` /
  `rows` / `columns` / `values` are still checked.
- **Ledger and docs.** `liveness/report.json` names a reader for `chart` only on
  non-joined reports and drops `chart` from the `blocks` row;
  `content/docs/ui/reports.mdx` lists what a joined container refuses.

<!-- adr-0087: registered report-joined-chart-removed -->
