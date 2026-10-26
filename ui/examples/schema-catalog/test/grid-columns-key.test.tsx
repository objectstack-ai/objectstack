/**
 * Catalog-wide guardrail: `grid` nodes declare their column count as `columns`,
 * never `cols` (objectui#4001).
 *
 * `GridSchema` declares `columns` (`packages/types/src/layout.ts`), the `grid`
 * renderer reads only `schema.columns`, and the registered `inputs` expose only
 * `columns` as a column key: its breakpoint object is the one per-breakpoint
 * spelling, since objectui#11505 retired the flat `smColumns` … `xlColumns`.
 * `cols` was never declared by the spec, the types, or the registry — nothing in
 * `core` / `react` / `types` normalizes it. Thirteen catalog examples spelled it
 * anyway, so the engine dropped the value on the floor: `baseCols` fell back to
 * its literal `2` default AND the mobile-first ramp never fired (it is gated on
 * `typeof schema.columns === 'number'`), producing a flat two columns at EVERY
 * breakpoint. Examples asking for three or four columns rendered as two on the
 * docs site, in production builds included.
 *
 * The fix is at the producer, not the renderer: no `schema.columns ?? schema.cols`
 * alias was added, because a lenient consumer fossilizes the wrong spelling into a
 * second de-facto contract (AGENTS.md #0.1). This file is the ratchet that keeps
 * the fourteenth `cols` out — every shipped example is copy-paste reference
 * material and an AI few-shot retrieval source, so a wrong key here teaches the
 * mistake at scale.
 *
 * Two different facts get pinned:
 *
 *  1. DATA — no `grid` node anywhere in the catalog carries a `cols` key, and the
 *     thirteen repaired examples each still declare the column count they were
 *     written to demonstrate (so the guard cannot pass by the keys having simply
 *     been deleted).
 *  2. RENDER — a sample of the repaired examples, driven through the real
 *     registered `grid` renderer, produces the responsive class ramp. These are
 *     the NEW correct values: every one of them differs from what `cols` produced
 *     (`grid grid-cols-2 gap-N`), including the "coincidentally 2" cases, whose
 *     base breakpoint now collapses to one column as the ramp intends.
 *
 * Module-scope import of `@object-ui/components`, not `beforeAll` (AGENTS.md
 * §测试纪律): registering the renderers is an unbounded module load and must not
 * be billed to a bounded hook timeout.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@object-ui/components';
import { SchemaRenderer } from '@object-ui/react';
import { allExamples } from '../src/index.js';

type Node = Record<string, unknown>;

/** Collect every `type: 'grid'` node anywhere in a schema tree. */
function collectGridNodes(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) {
    for (const item of node) collectGridNodes(item, out);
    return out;
  }
  if (node && typeof node === 'object') {
    const rec = node as Node;
    if (rec.type === 'grid') out.push(rec);
    for (const value of Object.values(rec)) collectGridNodes(value, out);
  }
  return out;
}

/**
 * The thirteen examples repaired by #4001, with the column count each one was
 * written to demonstrate. Asserting the VALUE (not merely the absence of `cols`)
 * is what makes the ban above non-vacuous: dropping the key entirely would
 * silence the ban while re-breaking the example.
 */
const REPAIRED: ReadonlyArray<readonly [string, number]> = [
  ['auth/signup', 2],
  ['components-basic-div/grid-layout', 2],
  ['components-complex-resizable/complex-layout', 2],
  ['components-data-display-statistic/metrics-grid', 3],
  ['components-data-display-statistic/sales-dashboard', 2],
  ['components-layout-page/full-dashboard', 4],
  ['components-layout-page/page-with-header', 3],
  ['forms/contact-form', 2],
  // Was `plugin-view/form-view-mode` until objectui#5113. The entry is the same
  // file with the same two-column grid node — it moved out of `plugin-view`
  // because it is a hand-composed form layout, not an example of that plugin,
  // whose three entries now author `object-view`. Renamed here rather than
  // dropped: the repair this row pins is still in the catalog.
  ['forms/create-user-form', 2],
  ['forms/payment-form', 3],
  ['report/report-header-with-kpis', 4],
  ['theme/semantic-color-palette', 4],
  ['theme/theme-aware-ui-elements', 2],
];

describe('schema-catalog — grid nodes spell their column count `columns` (#4001)', () => {
  it('no grid node in the catalog carries an undeclared `cols` key', () => {
    const offenders = allExamples().flatMap((example) =>
      collectGridNodes(example.schema)
        .filter((node) => Object.hasOwn(node, 'cols'))
        .map((node) => `${example.id} (cols: ${JSON.stringify(node.cols)})`),
    );
    expect(
      offenders,
      '`cols` is not declared by GridSchema, the grid renderer, or the registry — ' +
        'the engine drops it silently and the example renders 2 columns at every ' +
        'breakpoint. Spell it `columns`; do not teach the renderer the alias (#4001).',
    ).toEqual([]);
  });

  it('sees enough grid nodes for the ban to mean something (guard is not vacuous)', () => {
    const gridNodes = allExamples().flatMap((example) => collectGridNodes(example.schema));
    // 21 at the time of writing; a floor, so adding examples never fails this.
    expect(gridNodes.length).toBeGreaterThanOrEqual(21);
  });

  it.each(REPAIRED)('%s declares columns: %i', (id, columns) => {
    const example = allExamples().find((e) => e.id === id);
    expect(example, `${id} is missing from the catalog`).toBeTruthy();
    const declared = collectGridNodes(example!.schema)
      .map((node) => node.columns)
      .filter((value) => typeof value === 'number');
    expect(declared).toContain(columns);
  });
});

/**
 * Render-level pins. The class strings below are the CORRECTED output — under
 * `cols` every one of these grids rendered the flat `grid grid-cols-2 gap-N`
 * fallback instead.
 */
describe('repaired grid examples render the responsive ramp (#4001)', () => {
  const pins: ReadonlyArray<readonly [string, string]> = [
    // columns: 3 — was `grid grid-cols-2 gap-4`
    [
      'components-data-display-statistic/metrics-grid',
      'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4',
    ],
    // columns: 4 — was `grid grid-cols-2 gap-4`
    [
      'report/report-header-with-kpis',
      'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4',
    ],
    // columns: 4 + className passthrough — was `grid grid-cols-2 gap-4 mb-6`
    [
      'components-layout-page/full-dashboard',
      'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6',
    ],
    // columns: 4 with a non-default gap — was `grid grid-cols-2 gap-3 p-4`
    [
      'theme/semantic-color-palette',
      'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 p-4',
    ],
    // columns: 2 — the `div` → `grid` migration exemplar that
    // `content/docs/components/basic/div.mdx` points authors at. Its column count
    // matched the old default, so the bug was invisible here; the ramp still
    // changes the base breakpoint from two columns to one.
    [
      'components-basic-div/grid-layout',
      'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 gap-4',
    ],
  ];

  it.each(pins)('%s renders %s', (id, expected) => {
    const example = allExamples().find((e) => e.id === id);
    expect(example, `${id} is missing from the catalog`).toBeTruthy();
    const [gridNode] = collectGridNodes(example!.schema);
    expect(gridNode, `${id} has no grid node`).toBeTruthy();

    // Through the real `SchemaRenderer`, not `ComponentRegistry.get('grid')`
    // directly: the grid renderer reads its Tailwind overrides from the
    // `className` PROP, and it is `SchemaRenderer` that plumbs `schema.className`
    // into it (`SchemaRenderer.tsx` sets both spellings). Rendering the registry
    // component by hand silently drops the authored `className` and the pin would
    // then be blind to it — measured while writing this test.
    const { container } = render(<SchemaRenderer schema={gridNode as never} />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toBe(expected);
  });
});
