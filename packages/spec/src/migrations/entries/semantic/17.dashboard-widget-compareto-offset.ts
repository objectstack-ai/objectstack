// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'dashboard-widget-compareto-offset',
  surface: "dashboard.widgets[].compareTo: { offset: '7d' | '1M' | … } (every duration except '1y')",
  replacement: "compareTo: { kind: 'previousPeriod' } plus an explicit window on the widget's own `filter`",
  reason:
    'The widget declared three comparison arms; the analytics executor implements one shape, '
    + '`{ kind, dimension? }`, with no `offset` concept in it at all. On the ADR-0021 dataset '
    + 'path — the spec\'s single author-facing analytics shape — `{ offset }` was forwarded '
    + 'verbatim into that contract and threw `compareTo requires a timeDimension "undefined"`, '
    + 'taking the widget down; the arm ever only ran on the legacy inline chart path (#5011). '
    + "The conversion rewrites `{ offset: '1y' }`, which IS `previousYear` by definition. Every "
    + 'other duration has NO faithful target: `previousPeriod` shifts by the length of whatever '
    + "window the widget's filter resolves to, which equals `7d` only when that window happens "
    + 'to be seven days long. Rewriting mechanically would silently change which rows the '
    + 'comparison column counts — a wrong number rather than a missing one, which is strictly '
    + 'worse and exactly the class this convergence exists to end. Re-stating the intended '
    + 'window is a judgment about the presentation, not a transform.',
  acceptanceCriteria:
    'No dashboard widget declares `compareTo.offset`. Each former offset comparison states its '
    + "window on the widget's `filter` and compares with `compareTo: { kind: 'previousPeriod' }` "
    + "(or `'previousYear'`), and `dimension` is named wherever the selection dates more than one "
    + 'time dimension. `objectstack validate` passes, and each affected widget renders a '
    + '`<measure>__compare` column over the window its author intended.',
};
