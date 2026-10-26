/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7624 — no dashboard node in the catalog authors a root `title`.
 *
 * ## Why a pin, for six deleted lines
 *
 * Because nothing else in this repo can notice the key coming back. Measured
 * on the tree this file was added to:
 *
 *  - **No renderer reads it.** objectui#7509 (PR #7622) retired the root
 *    `title` arm in all five surfaces; `DashboardRenderer` now reads
 *    `schema.label` and nothing else. So a document that re-authors `title`
 *    renders identically to one that does not — no test can go red on pixels.
 *  - **`@object-ui/types` still DECLARES it.** `DashboardComponentSchema`
 *    carries `title?: string` ("Dashboard title displayed in the header"), so
 *    tsc accepts the key; and the Zod twin ACCEPTS AND PRESERVES it (measured:
 *    `safeParse` succeeds and `data.title` survives, because the twin does not
 *    declare `title` itself and `BaseSchema` is `.passthrough()`). A
 *    declared-but-unread key is refused by neither half of this repo's own
 *    contract.
 *  - **`@objectstack/spec` refuses it, but is not this corpus's validator.**
 *    `DashboardSchema.safeParse` reports `unrecognized_keys(['type','title'])`
 *    naming the repair (`title` to `label`) — and reports
 *    `unrecognized_keys(['type'])` for the same document with `title` removed,
 *    which is how that reading was confirmed to be about `title` by name and
 *    not about the document generally. But these entries are ObjectUI SDUI
 *    component documents, not spec metadata documents: they fail that parse
 *    either way (on `name`, `label`, and the widgets' `dataset`/`values`), so
 *    the spec's refusal never reaches them as a gate.
 *
 * Three receivers, and not one of them turns red. That is the entire argument
 * for pinning it here instead: the catalog is an authoring corpus — the same
 * standing `DashboardGridLayout.legacyRetired.test.tsx` claims for it — and a
 * corpus repair nothing pins is a repair that regresses silently.
 *
 * ## The `label` control is DARK, and is deliberately not asserted
 *
 * Zero catalog dashboards author `label` either, so a probe over this corpus
 * cannot discriminate `title` from `label` — it can only show it reaches these
 * nodes at all, which the non-vacuity case below does. Asserting "zero `label`"
 * would be worse than useless: `label` is the CORRECT spelling and the one a
 * later card should add, so pinning its absence would turn red on the repair.
 * The absence is therefore recorded here in prose and measured nowhere.
 *
 * ## What this file must NOT be satisfied by
 *
 * A blind sweep deleting every `title` in the corpus. `widget.title` is
 * `DashboardWidgetSchema.title` — a DIFFERENT, declared, live key that
 * `DashboardRenderer` renders into each widget card. The two are told apart by
 * RECEIVER, not by spelling, so the last case asserts the widget titles are
 * still there.
 */
import { describe, it, expect } from 'vitest';
import { allExamples } from '../src/index.js';

/** A dashboard-shaped node: one carrying a `widgets` array. */
interface DashboardNode {
  widgets: unknown[];
  [key: string]: unknown;
}

const isDashboardNode = (value: unknown): value is DashboardNode =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { widgets?: unknown }).widgets);

/** Every dashboard-shaped node in the corpus, at any depth, with its location. */
function collectDashboardNodes(): Array<{ where: string; node: DashboardNode }> {
  const found: Array<{ where: string; node: DashboardNode }> = [];
  const walk = (value: unknown, where: string): void => {
    if (Array.isArray(value)) {
      value.forEach((child, i) => walk(child, `${where}[${i}]`));
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    if (isDashboardNode(value)) found.push({ where, node: value });
    for (const [key, child] of Object.entries(value)) walk(child, `${where}.${key}`);
  };
  // `allExamples()` is the generated registry, and
  // `scripts/__tests__/catalog-index-regenerable-4633.test.ts` pins it against
  // its generator with `--check` — so this really is every shipped entry, not
  // just the ones someone remembered to register.
  for (const example of allExamples()) walk(example.schema, example.id);
  return found;
}

const dashboardNodes = collectDashboardNodes();

describe('catalog dashboards author no root `title` (objectui#7624)', () => {
  /**
   * NON-VACUITY. Every assertion below is over `dashboardNodes`; an empty
   * collection satisfies all of them while measuring nothing. This is also the
   * only thing the sweep's `label` half could ever have shown — that the probe
   * reaches these nodes.
   */
  it('the walk reaches the dashboard nodes it claims to measure', () => {
    expect(dashboardNodes.length).toBeGreaterThanOrEqual(9);
  });

  it('no dashboard node authors `title` on the dashboard itself', () => {
    const offenders = dashboardNodes
      .filter(({ node }) => 'title' in node)
      .map(({ where, node }) => `${where}: ${JSON.stringify(node.title)}`);
    expect(
      offenders,
      'a catalog dashboard authors a root `title` again. No arm reads it ' +
        '(objectui#7509 retired all five) and `@objectstack/spec` refuses it by ' +
        'name, so it configures nothing and teaches the next author a dead key. ' +
        'The header spelling is `label`, and it only renders when `header` is ' +
        'also declared (objectui#5812).',
    ).toEqual([]);
  });

  /**
   * COUNTER-PROBE. The case above is an assertion that something is absent, so
   * on its own it is indistinguishable from a predicate that can never fire.
   * This runs the same predicate over a node that DOES carry the key.
   */
  it('the predicate above still catches a dashboard that does carry `title`', () => {
    const planted = [
      ...dashboardNodes,
      { where: 'planted/synthetic', node: { type: 'dashboard', title: 'Sales Overview', widgets: [] } },
    ];
    const offenders = planted.filter(({ node }) => 'title' in node).map(({ where }) => where);
    expect(offenders).toEqual(['planted/synthetic']);
  });

  /**
   * MUST-NOT-CHANGE. `widget.title` is a live declared key rendered into every
   * widget card; deleting it would satisfy a naive reading of this file while
   * blanking the corpus's widget headings.
   */
  it('the widgets still carry their own `title` — a different, live key', () => {
    const widgetTitles = dashboardNodes.flatMap(({ node }) =>
      node.widgets.filter(
        (w): w is { title: string } =>
          typeof w === 'object' &&
          w !== null &&
          typeof (w as { title?: unknown }).title === 'string' &&
          (w as { title: string }).title.length > 0,
      ),
    );
    expect(widgetTitles.length).toBeGreaterThan(0);
  });
});
