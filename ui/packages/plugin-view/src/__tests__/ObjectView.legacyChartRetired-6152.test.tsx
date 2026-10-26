/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6152 round 15 — `generateViewSchema`'s legacy chart path is retired,
 * and its development-only flat-key warning names only keys a spec block
 * declares.
 *
 * ## 1 · the chart branch
 *
 * A chart block that names no `dataset` used to be translated here from the
 * pre-ADR-0021 inline axes (`xAxisField` / `categoryField`, `yAxisFields` /
 * `valueField`, `aggregation`) into an object-bound `aggregate`, floored at
 * `'name'` / `'value'` when the block declared none. The protocol's chart block
 * refuses those axes by name, so the path retired with them, as it did in
 * `ListView`'s `case 'chart'` and on app-shell's object page in the same round.
 * The branch now builds the UNBOUND node — the object, the declared
 * `chartType`, and no category — which `ObjectChart` refuses on screen
 * (objectui#8168; that refusal on this exact node shape is pinned in
 * `plugin-charts`' `ObjectChart.absentCategoryAxisRefusal-8168.test.tsx`).
 *
 * ## 2 · the warning
 *
 * The warning's list named `dateField`, `groupBy`, `groupField`, `imageField`
 * and `subtitleField` and told an author to move them into the view's own
 * per-kind block — where every door refuses each of them by name. It now names
 * only keys some spec per-kind block declares. Asserted on the console text the
 * author reads, with a declared flat key as the lit control.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

const rendered: any[] = [];

vi.mock('@object-ui/react', async (importOriginal) => {
  const ReactMod = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => {
      rendered.push(schema);
      return <div data-testid="schema-renderer">{schema?.type}</div>;
    },
    SchemaRendererContext: ReactMod.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const dataSource = (): any => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: { name: { name: 'name', type: 'text' } } }),
});

/** Mount an `object-view` whose host `views` entry is one view of `type`, and return the node it generated. */
async function generatedNode(type: string, view: Record<string, unknown>): Promise<any> {
  cleanup();
  rendered.length = 0;
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'task' } as unknown as ObjectViewSchema}
      views={[{ id: 'v', label: 'View', type, ...view }] as any}
      dataSource={dataSource()}
    />,
  );
  await waitFor(() => expect(rendered.length).toBeGreaterThan(0));
  return rendered[rendered.length - 1];
}

beforeEach(() => {
  rendered.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  cleanup();
});

describe('1 · a chart block that names no dataset binds nothing (objectui#6152 round 15)', () => {
  it.each([
    ['the retired `xAxisField` / `yAxisFields` / `aggregation` axes', { chart: { chartType: 'line', xAxisField: 'stage', yAxisFields: ['amount'], aggregation: 'sum' } }],
    ['the retired `categoryField` / `valueField` spelling', { chart: { chartType: 'line', categoryField: 'stage', valueField: 'amount' } }],
    ['a block with no binding at all (the floors used to bind `name` / `value`)', { chart: { chartType: 'line' } }],
  ])('%s → the unbound node: the object and `chartType`, no aggregate, no axis, no series', async (_label, view) => {
    const node = await generatedNode('chart', view);
    expect(node.type).toBe('object-chart');
    expect(node.objectName).toBe('task');
    expect(node.chartType).toBe('line');
    for (const key of ['aggregate', 'xAxisKey', 'series', 'dataset'] as const) {
      expect(key in node, `\`${key}\` reached the unbound chart node`).toBe(false);
    }
  });

  it('CONTROL: a dataset block still builds the dataset node', async () => {
    const node = await generatedNode('chart', {
      chart: { chartType: 'bar', dataset: 'deals_by_stage', dimensions: ['stage'], values: ['amount'] },
    });
    expect(node).toMatchObject({
      type: 'object-chart',
      dataset: 'deals_by_stage',
      dimensions: ['stage'],
      values: ['amount'],
      xAxisKey: 'stage',
    });
    expect('objectName' in node).toBe(false);
    expect('aggregate' in node).toBe(false);
  });
});

describe('2 · the development-only flat-key warning names only declared keys (objectui#6152 round 15)', () => {
  const warningsFor = async (view: Record<string, unknown>): Promise<string[]> => {
    vi.stubEnv('NODE_ENV', 'development');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await generatedNode('kanban', { kanban: { groupByField: 'stage' }, ...view });
    return warn.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.startsWith('[Spec Compliance] The view uses flat properties'));
  };

  it.each(['dateField', 'groupBy', 'groupField', 'imageField', 'subtitleField'])(
    'a flat `%s` is not named: every door refuses it inside the block too',
    async (key) => {
      // The lit control rides in the same view, so an empty list cannot pass:
      // `titleField` written flat, which the kanban block declares.
      // The warning runs once per schema computation, so it may print more
      // than once; every print must agree.
      const messages = await warningsFor({ [key]: 'x', titleField: 'name' });
      expect(messages.length).toBeGreaterThan(0);
      for (const message of messages) {
        expect(message).toContain('"titleField"');
        expect(message).not.toContain(`"${key}"`);
      }
    },
  );

  it('CONTROL: with no flat key at all, nothing is warned', async () => {
    expect(await warningsFor({})).toEqual([]);
  });
});
