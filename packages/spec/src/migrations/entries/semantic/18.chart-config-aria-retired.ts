// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// Maintainer decision batch #118 item 2 (ADR-0049 enforce-or-remove) — the D3
// entry of the `chart-config-aria-removed` family (ruling B on #17152: one D3
// entry per retirement family, even when D2 is lossless). Registered keys:
// `ui/ChartConfig:aria` and `ui/ReportChart:aria`, over three authored sites.
// The strip changes nothing a screen reader hears; the accessible name the
// author wrote was never announced, and moving it is the author's edit.
export const entry: SemanticMigration = {
  id: 'chart-config-aria-retired',
  surface: 'dashboard.widgets[].chartConfig.aria / report.chart.aria / report.blocks[].chart.aria — '
    + 'the ARIA block on a chart config',
  replacement: 'The sibling `description`, which the chart renderer lowers onto the chart graphic '
    + 'as its accessible name (`role="img"` with an aria-label). One accessibility vocabulary per '
    + 'chart node.',
  reason: 'The D2 conversion `chart-config-aria-removed` deletes `aria` from every dashboard widget '
    + 'chart config, report chart and report block chart, and the delete is lossless: no chart '
    + 'renderer on either face ever applied the block, so the ARIA attributes it declared never '
    + 'reached the DOM. The residue is accessibility work the author did that no user benefited '
    + 'from. An author who wrote `aria.label` for a chart believed screen-reader users heard that '
    + 'name; they heard the `description` if one was set, and nothing specific if not. The strip '
    + 'deletes the label text along with the key, and only the author can say whether that text '
    + 'should become the chart\'s `description` — a field that other readers of the chart may also '
    + 'show — or whether the existing description already says it.',
  acceptanceCriteria: 'No chart config on a dashboard widget, a report or a report block carries '
    + '`aria`; the parse refuses it. Every chart that had carried an `aria.label` has a '
    + '`description` conveying what that label was meant to announce, or the author has confirmed '
    + 'the existing description does. With a screen reader, focusing the chart graphic announces '
    + 'the description as its name.',
  relevantWhen: { kind: 'stack-declares', keys: ['dashboards', 'reports', 'pages'] },
};
