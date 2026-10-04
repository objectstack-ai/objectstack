---
'@objectstack/spec': minor
---

Every block of a `joined` report must bind a `dataset`: a block with none is refused at `blocks[i].dataset`, by name, with the prescription to bind the block to a dataset.

Clause-②: yes (narrowing)

<!-- adr-0087: registered ui-report-joined-block-dataset-required -->

**BREAKING**: an accept-set narrowing on a published authoring surface, shipped as `minor` under the launch-window convention for accept-set narrowings.

**Why.** A `joined` report carries its data on `blocks`, each an independent query over that block's own `dataset`, and the container selects nothing. `ReportSchema`'s refinement comment and the reports guide both said each block is dataset-bound, but the joined arm only required `blocks` to be non-empty, and a block's `dataset` is optional on its shape. So a block with no `dataset` parsed, `objectstack validate` exited 0 on it, the metadata save door stored it, and the report drew nothing for it: the joined renderer issues no query for an unbound block and draws it as an empty table, a report whose blocks all lack one falls through to the pre-9.0 presentation bridge, which issues no query either, and a dashboard drill-down that opens that report lists the records instead of drawing it.

**What is refused.** On a report whose `type` is `joined`, each block with no `dataset`. The issue's `code` is `custom`, at `blocks.N.dataset`, one per unbound block, and its message names the block: *a `joined` report draws each block from that block's own `dataset`, and block `NAME` binds none, so nothing queries it and it draws no rows. Bind the block to a dataset: set its `dataset` to the dataset whose measures (`values`) and dimensions (`rows`) it shows.* It is an arm of `ReportSchema`'s own refinement, so it reaches `defineReport`, `defineStack` (`STACK_SCHEMA_INVALID`, 422, at `reports.N.blocks.M.dataset`), `os validate` / `os build`, and the metadata save door (`422 INVALID_METADATA`). A stored report row is not rewritten: it carries the same issue in its read-side `_diagnostics` and is refused on its next save.

**What stays accepted, byte for byte.** A `joined` report whose blocks all bind a `dataset`; every non-joined report, including one that carries `blocks` (they are read on a `joined` report only); and `JoinedReportBlockSchema` parsed on its own, where `dataset` stays optional.

## FROM → TO

| you wrote | write instead |
|:--|:--|
| a `joined` report block with no `dataset`, e.g. `{ name: 'open_block', label: 'Open' }` | the same block bound to the dataset it shows: `{ name: 'open_block', label: 'Open', dataset: 'task_metrics', rows: ['status'], values: ['task_count'] }` |
| a `joined` report whose blocks all bind a `dataset`, or any non-joined report | unchanged |

**The one-line fix: set each block's `dataset` to the dataset whose measures it shows, or delete a block that has nothing to show (a `joined` report keeps at least one block).** The renderer never drew an unbound block, so binding it is the first time it draws anything.

**Who is affected, measured.** No joined report with an unbound block exists in this repository's `examples/**`, `packages/**`, `skills/**` or `content/docs/**`: the showcase's one joined report, the reports guide's example and every test fixture bind each block, apart from one metadata-door test fixture that left its block unbound on purpose and is bound in this change. The hotcrm application's one joined report binds every block, and the cloud repository has no joined report. Deployed metadata was not measured. Studio's report inspector can still produce one: its `blocks` repeater adds a blank row and requires no column of it, so a block saved with only a name is now refused at save, at `blocks.N.dataset`, where it used to be stored and draw nothing.

### The kit

- **The refusal.** A per-block arm of the joined branch of `ReportSchema`'s refinement (`ui/report.zod.ts`), beside the container refusals for `dataset` / `rows` / `columns` / `values`, `order` and `chart`. The block's `dataset` description now says a joined report refuses a block without one, and the generated reference page carries it.
- **The ledger.** The D3 semantic entry `ui-report-joined-block-dataset-required` (protocol 18) and its step-18 rationale fragment. No key is removed, so there is no tombstone, and there is no D2 conversion: which dataset a block shows is the author's decision, and no rewrite can name it.
