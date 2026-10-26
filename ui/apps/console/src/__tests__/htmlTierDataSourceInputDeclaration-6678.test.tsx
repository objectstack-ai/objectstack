/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `PageComponentSchema.dataSource` on the html tier: the one working saved-view
 * spelling must stop being reported as a prop that does not exist
 * (objectui#6678).
 *
 * ## What was measured, and why it is worse than noise
 *
 * `dataSource={{object, view}}` is the spec's per-element data binding and the
 * ONLY spelling that resolves a saved view for an object-bound block. It works
 * — and it drew the same `unknown-prop` warning as the two spellings that do
 * nothing:
 *
 * | page source                                | diagnostic     | columns      |
 * | ------------------------------------------ | -------------- | ------------ |
 * | `dataSource={{object:'…', view:'all'}}`     | `unknown-prop` | from the view|
 * | `viewName="all"`                            | `unknown-prop` | none         |
 * | `view="all"`                                | `unknown-prop` | none         |
 *
 * Identical reports for one key that works and two that do not, on the tier
 * meant to accept AI-authored pages, where the diagnostic IS the contract. The
 * objectui#6598 reporter tried the two that do nothing and gave up.
 *
 * ## The ruling this pins (2026-08-29, maintainer)
 *
 * Option B in the INJECTION form: the declaration is emitted mechanically at
 * the `ElementDataSourceGate` wrapping seam, so a block declares the key from
 * the same place that reads it. Option A — adding `dataSource` to
 * `sdui-parser`'s `BASE_PROPS` — was refused, because that set mirrors
 * `BaseSchema` and silencing the key on blocks that do NOT read it would make
 * the diagnostic lie in the other direction.
 *
 * So this file pins BOTH directions, and the second one is the one that catches
 * the over-broad fix:
 *
 *  1. gate-wrapped block (`list-view`) — no diagnostic AND the binding still
 *     works. The columns are asserted, not just the absence of a warning: a fix
 *     that silenced the diagnostic and broke the binding would pass half of
 *     this pin and be worse than the defect.
 *  2. NON-wrapped block (`flex`, `card`) — `unknown-prop` still fires. Had
 *     `BASE_PROPS` been touched, this goes red.
 *
 * ## Why it goes through the REAL page path
 *
 * Both halves are properties of the live tier, not of a fixture: the diagnostic
 * comes from `compile()` against a manifest built the way
 * `packages/components/src/renderers/layout/page.tsx` builds it (see
 * {@link livePageManifest}), and the columns come from the real `list-view`
 * registration rendering through the real `object-grid`. A hand-written
 * manifest would agree with itself and prove nothing about what an author sees.
 *
 * It lives in `apps/console` rather than beside `plugin-list` for the reason the
 * suites next door already state: the claim is about what an AUTHOR is told, and
 * that answer is produced from the whole registration graph plus the real
 * `object-grid`. `plugin-list` depends on neither `@object-ui/sdui-parser` nor
 * `@object-ui/plugin-grid`, and taking those dependencies to host a test would
 * be the heavier change.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import { compile, manifestFromConfigs } from '@object-ui/sdui-parser';
import type { Diagnostic } from '@object-ui/sdui-parser';

// The full registration graph — the same pair `dev/manifest-dump.tsx` builds the
// published artifacts from, and the pair every live-path suite in this directory
// reads. `list-view` and the REAL `object-grid` both arrive through it.
import '@object-ui/components';
import '../register-plugins';

const OBJECT = 'opportunity';

/**
 * The saved view the binding names. Its `columns` are the observable proof that
 * the binding RESOLVED — they are not the object's default column set, so a
 * block that ignored the binding cannot produce them by accident.
 */
const SAVED_VIEW = {
  name: 'all',
  label: 'All Opportunities',
  columns: ['name', 'amount'],
};

const dataSource = {
  find: async () => ({
    data: [
      { id: 'o-1', name: 'Acme expansion', amount: 1000, stage: 'new' },
      { id: 'o-2', name: 'Globex renewal', amount: 2000, stage: 'won' },
    ],
    total: 23,
    hasMore: true,
  }),
  findOne: async () => null,
  create: async () => ({}),
  update: async () => ({}),
  delete: async () => ({}),
  count: async () => 23,
  getObjectSchema: async (name: string) => ({
    name,
    label: 'Opportunity',
    fields: {
      id: { type: 'text', label: 'Id', hidden: true },
      name: { type: 'text', label: 'Opportunity Name' },
      stage: { type: 'text', label: 'Stage' },
      amount: { type: 'currency', label: 'Amount' },
    },
    // Where `useElementDataSource` reads an object's saved views from.
    listViews: { all: SAVED_VIEW },
  }),
  getObjects: async () => [],
  onMutation: () => () => {},
} as any;

/**
 * The manifest an html-kind page validates against, built the way the renderer
 * builds it — `ComponentRegistry.getKnownTypes()` + each type's declared
 * `inputs`, mirroring `page.tsx`'s `getJsxManifest()`. Rebuilt per call rather
 * than cached, because the whole point of this file is that a registration's
 * `inputs` decide what an author is told.
 */
const livePageManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((t) => {
      const meta = ComponentRegistry.getMeta(t);
      return {
        type: t,
        namespace: meta?.namespace,
        isContainer: meta?.isContainer,
        inputs: meta?.inputs,
      };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

/** Every `unknown-prop` diagnostic the live tier reports for `source`. */
const unknownProps = (source: string) =>
  compile(source, livePageManifest())
    .diagnostics.filter((d: Diagnostic) => d.code === 'unknown-prop')
    .map((d: Diagnostic) => d.message);

async function renderHtmlPage(source: string) {
  const { container } = render(
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer
        schema={{ type: 'page', kind: 'html', name: 'datasource_page', source } as any}
      />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(container.querySelector('table')).toBeTruthy());
  return container;
}

const headersOf = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('th')).map((th) => (th.textContent || '').trim());

const BINDING = `dataSource={{object: '${OBJECT}', view: 'all'}}`;

describe("kind:'html' — the spec `dataSource` binding on a gate-wrapped block (#6678)", () => {
  it('draws no unknown-prop diagnostic', () => {
    expect(unknownProps(`<list-view data={{provider:'object',object:'${OBJECT}'}} ${BINDING} />`)).toEqual([]);
  });

  it('still resolves the saved view it names — the binding was not silenced, it was declared', async () => {
    const container = await renderHtmlPage(`<list-view data={{provider:'object',object:'${OBJECT}'}} ${BINDING} />`);

    await waitFor(() => expect(headersOf(container).length).toBeGreaterThan(1));
    const headers = headersOf(container);
    // The saved view's own column list, not the object's defaults: `stage` is a
    // visible field of the object and the view does not show it.
    expect(headers).toContain('Opportunity Name');
    expect(headers).toContain('Amount');
    expect(headers).not.toContain('Stage');
  });

  it('leaves the two non-working spellings reported, which is what makes the signal usable', () => {
    // The control for the pin above. If `viewName` / `view` went quiet too, the
    // fix would have widened the whitelist rather than declared the one key the
    // block reads — and the tier would be back to reporting nothing useful.
    expect(unknownProps(`<list-view data={{provider:'object',object:'${OBJECT}'}} viewName="all" />`)).toEqual([
      '<list-view> has no prop "viewName"',
    ]);
    expect(unknownProps(`<list-view data={{provider:'object',object:'${OBJECT}'}} view="all" />`)).toEqual([
      '<list-view> has no prop "view"',
    ]);
  });
});

describe("kind:'html' — `dataSource` on a NON gate-wrapped block still reports (#6678)", () => {
  // The pin that refuses option A. `flex` and `card` do not wrap
  // `ElementDataSourceGate` and read nothing from the binding, so an author who
  // writes it there must still be told. Adding `dataSource` to
  // `sdui-parser`'s `BASE_PROPS` would turn both of these green and make the
  // diagnostic lie in the other direction.
  it.each(['flex', 'card'])('%s reports unknown-prop for dataSource', (tag) => {
    expect(unknownProps(`<${tag} ${BINDING} />`)).toEqual([
      `<${tag}> has no prop "dataSource"`,
    ]);
  });
});
