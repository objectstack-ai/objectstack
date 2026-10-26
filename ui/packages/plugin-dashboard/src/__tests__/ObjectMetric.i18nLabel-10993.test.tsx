/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `object-metric`'s three `I18nLabel` members through the registry
 * (objectui#10993, batch 2).
 *
 * `@objectstack/spec` types `label`, `description` and `title` in
 * `ComponentPropsMap['object-metric']` as `I18nLabel`: a plain string or an
 * inline per-locale map. The renderers already resolve all three with
 * `pickLocalized` against the active UI language: `MetricWidget` for the tile's
 * heading (`label`) and the sub-caption under the value (`description`),
 * `ObjectMetricWidget` for the drill-down panel's heading (`title`, falling
 * back to `label`). The registration declared all three `'string'` only, so the
 * manifest gate reported `type-mismatch` on the legal map; objectui#10993
 * declares the `object` arm. This file is the render half the arm rests on (the
 * `ComponentInput.type` rule: the render site resolves the map, so the arm may
 * be declared); the manifest half is the console's
 * `i18nLabelInputsManifest-10993.test.ts`.
 *
 * `ObjectMetricWidget.i18nLabel.test.tsx` next door pins the same resolution
 * on the widget mounted directly. This file mounts the node the way a page
 * does: the `{ type, properties }` document through the real `SchemaRenderer`
 * and the registered `ObjectMetricBlock`, so the path from the authored keys to
 * the widget's props is under test too. Every map lists `en` FIRST, so under
 * `zh` a resolver that fell back to `en` or to the first entry would paint
 * English and fail the row. The plain-string rows are the controls.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
// Registers `object-metric` (the block under test) and, as a side effect, the
// `object-data-table` the drill drawer renders its body through. Module scope,
// never a hook, per AGENTS.md's flaky-test rule.
import '../index';

afterEach(cleanup);

/** `en` first on purpose; see the file header. */
const LABEL = { en: 'Pipeline', 'zh-CN': '销售管道' };
const DESCRIPTION = { en: 'This quarter', 'zh-CN': '本季度' };
const TITLE = { en: 'Open deals', 'zh-CN': '进行中的商机' };

const makeSource = () => ({
  aggregate: vi.fn(async () => [{ amount: 120 }]),
  find: vi.fn(async () => ({ data: [] })),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({ name: 'deal', fields: { amount: { type: 'number' } } })),
});

/** A JSON document: the node and its `properties` bag, nothing a host adds. */
const doc = (properties: Record<string, unknown>) => ({
  type: 'object-metric',
  properties: {
    objectName: 'deal',
    aggregate: { field: 'amount', function: 'sum' },
    drillDown: { enabled: true },
    ...properties,
  },
});

function mountIn(language: string, properties: Record<string, unknown>) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <SchemaRendererProvider dataSource={makeSource() as never}>
        <SchemaRenderer schema={doc(properties) as never} />
      </SchemaRendererProvider>
    </I18nProvider>,
  );
}

/**
 * The tile, found by its role: it is `role="button"` only while a drill handler
 * is attached, so finding it also proves the block rendered and the drill is
 * live rather than the registry's error fallback.
 */
const tile = () => screen.findByRole('button');

/**
 * Open the drill-down panel and find it by its accessible name, which is its
 * own title: the drawer names the dialog with `aria-labelledby` pointing at the
 * title element. That reads "the panel is headed by X" and nothing the body
 * shows. A bare `getByRole('heading')` over the dialog read the body too: once
 * the drill-down query settles, the body's empty state draws a heading of its
 * own beside the title, so that query raced the data source and threw "Found
 * multiple elements with the role heading" whenever it lost.
 */
async function drawerNamed(name: string): Promise<HTMLElement> {
  fireEvent.click(await tile());
  return screen.findByRole('dialog', { name });
}

describe('object-metric — the I18nLabel members through the registry (objectui#10993)', () => {
  it('zh: `label` and `description` paint their zh-CN entries on the tile', async () => {
    const { container } = mountIn('zh', { label: LABEL, description: DESCRIPTION });
    const card = await tile();
    expect(within(card).getByText('销售管道')).toBeInTheDocument();
    expect(await within(card).findByText('本季度')).toBeInTheDocument();
    expect(container.textContent ?? '').not.toContain('[object Object]');
    expect(container.textContent ?? '').not.toContain('failed to render');
  });

  it('en: the same maps paint their en entries', async () => {
    mountIn('en', { label: LABEL, description: DESCRIPTION });
    const card = await tile();
    expect(within(card).getByText('Pipeline')).toBeInTheDocument();
    expect(await within(card).findByText('This quarter')).toBeInTheDocument();
  });

  it('zh: a `title` map heads the drill-down panel', async () => {
    mountIn('zh', { label: LABEL, title: TITLE });
    expect(await drawerNamed('进行中的商机')).toBeInTheDocument();
  });

  it('en: the `title` map heads the panel in English', async () => {
    mountIn('en', { label: LABEL, title: TITLE });
    expect(await drawerNamed('Open deals')).toBeInTheDocument();
  });

  it('zh: with no `title`, the `label` map heads the panel', async () => {
    mountIn('zh', { label: LABEL });
    expect(await drawerNamed('销售管道')).toBeInTheDocument();
  });

  it('CONTROL: plain strings render exactly as authored, under zh', async () => {
    mountIn('zh', { label: 'Pipeline', description: 'This quarter', title: 'Open deals' });
    const card = await tile();
    expect(within(card).getByText('Pipeline')).toBeInTheDocument();
    expect(await within(card).findByText('This quarter')).toBeInTheDocument();
    expect(await drawerNamed('Open deals')).toBeInTheDocument();
  });
});
