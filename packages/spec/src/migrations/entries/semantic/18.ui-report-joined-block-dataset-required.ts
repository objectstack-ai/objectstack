// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// The D3 entry for the joined arm of `ReportSchema`'s refinement refusing a
// block that binds no `dataset`: the enforce arm of ADR-0049 enforce-or-remove,
// applied to the "each block dataset-bound" contract the schema comment and the
// reports guide already stated. It narrows a report's accept set; no key is
// removed, so there is no tombstone and no RETIRED_KEYS_BY_MAJOR row. There is
// no D2 conversion either: which dataset a block shows is the author's
// decision, and no rewrite can name it.
export const entry: SemanticMigration = {
  id: 'ui-report-joined-block-dataset-required',
  // No backticks and no pipes in `surface` — build-upgrade-guide.ts renders it
  // inside a code span.
  surface: 'reports[].blocks[].dataset on a report whose type is joined: a block that binds no dataset '
    + '(the joined arm of the ReportSchema refinement)',
  replacement: 'Bind the block to a dataset: set the block\'s `dataset` to the dataset whose measures '
    + '(`values`) and dimensions (`rows`) it shows. A block with nothing to show can be deleted '
    + 'instead, as long as the report keeps at least one block.',
  reason:
    'ADR-0021 single-form, enforced (ADR-0049 enforce-or-remove, the enforce arm). A `joined` report '
    + 'carries its data on `blocks`, each an independent query over that block\'s own `dataset`, and the '
    + 'container selects nothing: a container `dataset` is refused. `ReportSchema`\'s refinement comment '
    + 'and the reports guide both said each block is dataset-bound, but the joined arm required only that '
    + '`blocks` be non-empty, and a block\'s `dataset` is optional on its shape, so a block with no `dataset` '
    + 'parsed, passed `objectstack validate` and every save door, and drew nothing. Measured at this repo\'s '
    + '`.objectui-sha` pin `ab187972159583b595facdcae3c73b50f6f312e9`: the joined renderer hands each '
    + 'block\'s `dataset` to its table, whose query hook goes idle on an empty name, so an unbound block '
    + 'draws an empty table and issues no query; a report whose blocks all lack one fails the '
    + 'dataset-report guard and falls through to the pre-9.0 presentation bridge, which issues no query '
    + 'either, and a dashboard drill-down that opens that report lists the records instead of drawing '
    + 'it. Studio\'s report inspector authors blocks through the spec form\'s `blocks` repeater, which '
    + 'adds a blank row and requires no column of it, so a block saved with only a name reached the store '
    + 'with no error. The joined arm now refuses each such block at `blocks[i].dataset`, naming the block, '
    + 'with the prescription to bind it to a dataset. `dataset` stays optional on the block shape itself: '
    + '`blocks` is read only on a `joined` report, and a block on any other report type is ignored, as '
    + 'before. Ships at once, with no deprecation window: there is no window in which an unbound block '
    + 'draws anything, and there is no mechanical rewrite, because only the author knows which dataset '
    + 'the block was meant to show.',
  acceptanceCriteria:
    'WHICH DOOR: this is the spec schema\'s refusal, so it lands wherever a report is parsed through '
    + '`@objectstack/spec` — `defineReport`, `defineStack`, `os validate` / `os build`, and the metadata '
    + 'save door (the `report` entry of the metadata type registry) — as one `custom` issue per unbound '
    + 'block at `blocks.N.dataset`, naming the block. A stored `sys_metadata` report row is not rewritten: '
    + 'it carries the same issue in its read-side `_diagnostics` and is refused on its next save. Fix each '
    + 'by binding the block to the dataset it is meant to show, or by deleting the block, then check the '
    + 'rendered report: every block queries its dataset and draws its rows. A joined report whose blocks '
    + 'all bind a `dataset` parses byte-identically to before, and every non-joined report is untouched. '
    + 'Census at the time of the change: no joined report with an unbound block in this repository (one '
    + 'example-app report, one docs example and the test fixtures in `packages/lint`, '
    + '`packages/platform-objects` and `packages/spec` all bind every block; one metadata-door test '
    + 'fixture that left its block unbound on purpose was bound in the same change), in the hotcrm '
    + 'application (one joined report, every block bound) or in the cloud repository (no joined report '
    + 'exists).',
};
