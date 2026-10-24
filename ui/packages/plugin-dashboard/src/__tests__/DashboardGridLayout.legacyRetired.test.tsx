/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#4612 — the SECOND dashboard surface gets the same graceful fallback.
 *
 * `DashboardRenderer` has carried the framework#3320 legacy sentinel since the
 * retirement: a widget still holding the pre-ADR-0021 inline-analytics shape
 * (top-level `object`, no `dataset`, no inline `options.data`) renders a VISIBLE
 * error placeholder prompting a rebind. `DashboardGridLayout` — separately
 * exported, and then registered as the `dashboard-grid` SDUI component (retired
 * by objectui#10859 batch 8) — had none, so
 * the very same stored metadata fell through to its static-data branch with
 * `data: []`: a silent blank chart, no diagnostic, no path to fix. That is the
 * exact outcome `DashboardRenderer.legacyRetired.test.tsx`'s header says must not
 * happen, on the surface nobody pinned.
 *
 * The detector and the placeholder now live in ONE module
 * (`../legacyRetiredWidget`) with two consumers, because the defect existed
 * precisely because there were two surfaces and one fix.
 *
 * The negative controls are the binding half. `options.data = { provider:
 * 'object', … }` carries its OWN nested `object`/`aggregate` and is a DIFFERENT,
 * still-live authoring surface (the #4600 measurement's do-not-conflate note);
 * dataset widgets and static-data widgets are live too. None of them may acquire
 * the placeholder — on either surface.
 *
 * ⚠️ Dated note, 2026-10-03 — objectui#11525. When this header was written the
 * nested `provider: 'object'` config was live for every family. The
 * single-value family's is now retired: a dataset-less provider metric draws
 * this placeholder through each surface's metric arm, not through the shared
 * detector (`inlineObjectMetricRetired-11525.test.tsx`). The provider control
 * below is a `bar`, whose family stays live, so it holds as written. The rest
 * of this header is kept as the reading of objectui#4612.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
import { DashboardGridLayout } from '../DashboardGridLayout';

afterEach(cleanup);

/**
 * `object` / `categoryField` / `aggregate` are no longer part of
 * `DashboardWidgetSchema` — the cast mimics stored legacy metadata that predates
 * the ADR-0021 dataset shape, which is the only way this shape can still arrive.
 */
const dash = (widget: Record<string, unknown>): DashboardComponentSchema =>
  ({ type: 'dashboard', widgets: [widget] }) as unknown as DashboardComponentSchema;

/**
 * The catalog entry the two annotated rows below were transcribed from, named
 * once so the prose and the derived block at the bottom cannot drift apart.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CATALOG_FIXTURE = path.join(
  REPO_ROOT,
  'examples/schema-catalog/src/schemas/plugin-dashboard/filtered-dashboard.json',
);
const catalogWidgets = (
  JSON.parse(fs.readFileSync(CATALOG_FIXTURE, 'utf8')) as { widgets: Record<string, unknown>[] }
).widgets;

describe('DashboardGridLayout retired legacy widgets (#4612)', () => {
  it.each([
    ['chart', { id: 'w1', type: 'bar', object: 'invoices', categoryField: 'month', valueField: 'amount', aggregate: 'sum' }],
    // Transcribed from `filtered-dashboard.json` → `widgets[0]` as that fixture
    // stood at `8640cec19`, the commit that added this file. It was byte-for-byte
    // then — same keys, same order, same values — and it is NOT byte-for-byte
    // now: `e028dfcd8` (objectui#4600, PR #4615) migrated the `filtered-*`
    // entries off the retired shape 66 minutes later, onto inline
    // `options: { xField, yField, data }`, and objectui#11070 round 6
    // (objectui#11228 ruling C) then moved them to the dataset form, so
    // `widgets[0]` on disk is `{ id, title, type, dataset, dimensions, values }`
    // today.
    //
    // ⚠️ This row therefore does NOT carry the independent-corpus property the
    // original annotation claimed for it. It is a HISTORICAL specimen of stored
    // metadata, not a live transcription — which is the right thing to pin (a
    // renderer cannot refuse to receive stored metadata) but is worth strictly
    // less as evidence, so it is stated rather than left to be re-derived. No
    // live specimen can replace it; the derived block at the bottom measures
    // that, instead of asserting it here in prose the way this comment once did.
    ['catalog bar', { id: 'invoices_by_status', title: 'Invoices by Status', type: 'bar', object: 'invoices', categoryField: 'status', aggregate: 'count' }],
    // The pivot family, whose legacy spelling names `rowField`/`columnField`.
    ['pivot', { id: 'w1', type: 'pivot', object: 'invoices', rowField: 'region', valueField: 'amount' }],
    // The same fixture's `widgets[2]` at that same commit, and a LOOSER claim
    // than the row above ever made: its retired binding verbatim (`type`,
    // `object`, `aggregate`), with `id` genericised to `w1` and `title` /
    // `filterBindings` dropped. So this row was never byte-for-byte and never
    // said it was. `e028dfcd8` retired that widget's shape too, and round 6
    // moved it on again — `widgets[2]` is `{ id, title, type, dataset, values,
    // filterBindings }` today — so the same ⚠️ above applies to it.
    ['metric', { id: 'w1', type: 'metric', object: 'invoices', aggregate: 'count' }],
  ])('renders the visible placeholder for a legacy %s widget', (_kind, widget) => {
    render(<DashboardGridLayout schema={dash(widget)} />);
    expect(screen.getByText(/retired data format/i)).toBeInTheDocument();
  });

  it('states the rebind affordance verbatim, not merely "something is wrong"', () => {
    // The message IS the fix path — a placeholder that does not say what to do
    // is only a prettier blank. Pinned verbatim, and identically to the
    // DashboardRenderer surface (one shared constant, one wording).
    render(<DashboardGridLayout schema={dash({ id: 'w1', type: 'bar', object: 'invoices', aggregate: 'count' })} />);
    expect(
      screen.getByText('This widget uses a retired data format. Edit it to bind a dataset.'),
    ).toBeInTheDocument();
  });

  /**
   * The must-not-change half. Each control asserts BOTH that the placeholder is
   * absent AND that the widget was really rendered — otherwise "no placeholder"
   * would also be satisfied by a grid that threw or drew nothing, and the
   * control would pass for the wrong reason.
   */
  const renderOne = (widget: Record<string, unknown>) => {
    const { container } = render(<DashboardGridLayout schema={dash(widget)} />);
    expect(container.querySelector('[data-testid="grid-layout"]')).toBeInTheDocument();
    return container;
  };

  it('does NOT show the placeholder for a dataset-bound widget', () => {
    renderOne({ id: 'w1', type: 'bar', dataset: 'invoices', values: ['count'] });
    expect(screen.queryByText(/retired data format/i)).not.toBeInTheDocument();
  });

  it('does NOT show the placeholder for an options.data provider widget', () => {
    // The nested `{ provider: 'object', object, aggregate }` config is a
    // separate, LIVE surface. Its `object` is read off `widgetData`, never off
    // the widget top level — conflating the two would retire a working feature.
    renderOne({
      id: 'w1',
      type: 'bar',
      options: { data: { provider: 'object', object: 'invoices', aggregate: { field: 'amount', function: 'sum' } } },
    });
    expect(screen.queryByText(/retired data format/i)).not.toBeInTheDocument();
  });

  it('does NOT show the placeholder for a static-data widget', () => {
    renderOne({ id: 'w1', type: 'bar', options: { data: [{ name: 'A', value: 1 }] } });
    expect(screen.queryByText(/retired data format/i)).not.toBeInTheDocument();
  });

  it('does NOT show the placeholder for a static-data pivot widget', () => {
    // DashboardRenderer's pivot arm returns the placeholder for the WHOLE family
    // because that surface has no pivot renderer at all. This surface does, and
    // a static-data pivot is a live static-data widget — so the shared detector
    // is the inline-analytics sentinel (which the legacy pivot above matches via
    // its top-level `object`), NOT the family arm. Mirroring the family arm here
    // would have retired a working branch.
    renderOne({ id: 'w1', type: 'pivot', options: { data: [{ region: 'EMEA', amount: 1 }] } });
    expect(screen.queryByText(/retired data format/i)).not.toBeInTheDocument();
  });

  /**
   * The corpus half — DERIVED from the fixture, not transcribed from it
   * (objectui#7151).
   *
   * Two of the rows above are hand-written literals introduced by comments
   * naming a fixture. Those comments were TRUE when written and stopped being
   * true 66 minutes later, and nothing noticed for months: a comment cannot
   * detect the file it names changing, which is exactly what a test can do. So
   * the relationship stops being prose here and becomes a read.
   *
   * It reads the file off disk rather than importing it because this package's
   * `tsconfig.test.json` declares `"types": ["node"]` — the precondition
   * `packages/types/src/__tests__/timeline-catalog-fixture-migrated.test.ts`
   * could not meet in `packages/plugin-timeline` and had to relocate for. The
   * root Vitest config aliases `@object-ui/*` to sibling `src/`, so this file
   * needs no built dependency closure to resolve either half.
   *
   * What this block deliberately does NOT do is restore the independent-corpus
   * property the annotations above lost, because that property is no longer
   * obtainable. Measured across every JSON document in the repo when this block
   * was written (objectui#7151): 28 dashboard widgets, ZERO carrying the retired
   * top-level binding, against live controls of 15 `options`-shaped and 2
   * `dataset`-shaped widgets — a historical reading; objectui#11070 round 6
   * later moved those 15 to the dataset form. That zero is by
   * DESIGN, not by accident — the retirement's whole content is that no
   * authoring surface emits the shape (`WidgetConfigPanel` scrubs it on save via
   * `LEGACY_ANALYTICS_KEYS`), and the catalog is an authoring corpus. A specimen
   * reappearing there is therefore a catalog regression, which is the second
   * thing this block catches.
   */
  describe('the catalog entry those two rows name (objectui#7151)', () => {
    it('is on disk, and holds the widgets the derived rows below iterate', () => {
      // Asserted before anything consumes `catalogWidgets`: an emptied or
      // renamed `widgets` array turns the `it.each` below into ZERO tests and a
      // green run — the vacuous pass this whole block exists to end.
      expect(fs.existsSync(CATALOG_FIXTURE), `fixture not found at ${CATALOG_FIXTURE}`).toBe(true);
      expect(catalogWidgets.length).toBeGreaterThan(0);
    });

    it('carries NO widget in the retired shape — which is why those rows are hand-written', () => {
      expect(catalogWidgets.length).toBeGreaterThan(0);
      const retired = catalogWidgets.filter(
        (w) => 'object' in w || 'categoryField' in w || 'valueField' in w || 'aggregate' in w,
      );
      expect(
        retired,
        'a shipped catalog widget authors the retired pre-ADR-0021 binding again — either the catalog regressed, or there is finally a live corpus specimen to transcribe into the annotated rows above',
      ).toEqual([]);
    });

    // The independent-corpus property, restored on the side where the corpus
    // still HAS specimens: these are the real shipped documents, and the
    // detector must fire on none of them.
    it.each(catalogWidgets.map((w, i) => [`widgets[${i}]`, w] as [string, Record<string, unknown>]))(
      'does NOT show the placeholder for shipped catalog %s',
      (_where, widget) => {
        renderOne(widget);
        expect(screen.queryByText(/retired data format/i)).not.toBeInTheDocument();
      },
    );
  });
});
