/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10394 — the `object-gantt` registration declares the two record
 * sources `ObjectGanttSchema` already declares: `data` and `staticData`.
 *
 * Without an input, `sdui-parser`'s `validateTree` reported a block authored on
 * either key as `unknown-prop` (the objectui#7712 shape) while the schema
 * accepted it and the renderer drew it. objectui#7470 dropped `required` from
 * `objectName` and did not order these two, so they were left out then.
 *
 * `object-gantt` is the one registration key: the bare `gantt` key is retired
 * (objectui#8008, pinned by `bare-gantt-node-key-retired-8008.test.ts`).
 *
 * ## The rows
 *
 * Declaration:
 * 1. The html tier accepts a block authored on `staticData` alone, and on a
 *    `data` configuration alone — no diagnostic at all.
 * 2. Control for row 1: a bogus key is still reported, on a node bound by
 *    `objectName` so the row holds before and after the fix alike.
 * 3. The registration declares both keys (`objectName` as non-vacuity).
 * 4. Each declared ARM is the schema's own, read from `ObjectGanttSchema` with
 *    the refused spelling as the control, and the html tier enforces it: a
 *    bare array under `data` draws `type-mismatch`.
 * 5. Each description names the position it is true about.
 *
 * Behaviour, through the real `SchemaRenderer` — the claims the descriptions
 * make, measured rather than assumed:
 * 6. `data` wins over `staticData` and `objectName`; `staticData` wins over
 *    `objectName`; neither inline source queries the object.
 * 7. An `object` provider queries its own object, not `objectName`; a retired
 *    `api` block (objectstack#23082, objectui#12325) requests nothing and is
 *    answered like an unknown provider: `objectName` is queried.
 * 8. A bare array under `data` is not a record source: `staticData` beside it
 *    is what is charted.
 *
 * `filter` / `sort` on the inline rungs are pinned by
 * `ObjectGantt.inlineQueryKeys-8769.test.tsx` (its `staticDataSpelling` row),
 * not repeated here.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

// The bar canvas is irrelevant: every behaviour row reads WHICH rows reached
// the chart. Same stub the sibling `ObjectGantt` pins use.
vi.mock('../GanttView', () => ({
  GanttView: ({ tasks }: any) => (
    <div data-testid="gantt-view" data-task-ids={tasks.map((t: any) => String(t.id)).join(',')} />
  ),
}));

vi.mock('@object-ui/plugin-detail', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-detail')>()),
  RecordDetailDrawer: () => null,
  deriveRecordPageHref: () => null,
}));

import { ComponentRegistry } from '@object-ui/core';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';
import { ObjectGanttSchema } from '@object-ui/types/zod';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
import type { DataSource } from '@object-ui/types';
// Module scope, not a hook: this import IS the registration (AGENTS.md
// test-discipline section).
import '../index';

const TYPE = 'object-gantt';
const NAMESPACE = 'plugin-gantt';

const GANTT = { titleField: 'subject', startDateField: 'visible_from', endDateField: 'due_date' };
const DATA_ROWS = [
  { id: 'd1', subject: 'D1', visible_from: '2026-01-01', due_date: '2026-01-31' },
  { id: 'd2', subject: 'D2', visible_from: '2026-02-01', due_date: '2026-02-28' },
];
const STATIC_ROWS = [{ id: 's1', subject: 'S1', visible_from: '2026-03-01', due_date: '2026-03-31' }];
const VALUE_CONFIG = { provider: 'value', items: DATA_ROWS };

const declaredInputs = (): any[] =>
  ((ComponentRegistry.getConfig(TYPE, NAMESPACE) as any)?.inputs ?? []);

const declaredInput = (key: string): any => declaredInputs().find((i: any) => i.name === key);

const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

const diagnosticsOf = (node: Record<string, unknown>) =>
  validateTree({ type: TYPE, gantt: GANTT, ...node } as never, liveManifest()).diagnostics;

const schemaAccepts = (props: Record<string, unknown>): boolean =>
  ObjectGanttSchema.safeParse({ type: TYPE, gantt: GANTT, ...props }).success;

/** The clause each description must keep — fragments, so a wording pass does not red this file. */
const POSITION_PHRASES: Record<string, string[]> = {
  data: [
    '`{ provider, … }` data-source configuration',
    'read FIRST',
    'never reaches `staticData`',
    'A bare array is not this key’s shape',
  ],
  staticData: ['read SECOND', 'a `data` configuration wins', '`objectName` is read AFTER it'],
};

describe('objectui#10394 — the object-gantt registration declares data and staticData', () => {
  it('the html tier accepts a staticData-only gantt', () => {
    expect(diagnosticsOf({ staticData: STATIC_ROWS })).toEqual([]);
  });

  it('the html tier accepts a gantt on a data configuration alone', () => {
    expect(diagnosticsOf({ data: VALUE_CONFIG })).toEqual([]);
  });

  it('control: a bogus key is still reported', () => {
    expect(
      diagnosticsOf({ objectName: 'task', bogusProp: 'x' }).map((d) => [d.code, d.message]),
    ).toEqual([['unknown-prop', `<${TYPE}> has no prop "bogusProp"`]]);
  });

  it('the registration declares data and staticData', () => {
    const names = declaredInputs().map((i: any) => i.name);
    expect(names).toContain('objectName');
    expect(names).toContain('data');
    expect(names).toContain('staticData');
  });

  it('each declared arm is the schema arm, and the html tier enforces it', () => {
    expect(declaredInput('data').type).toBe('object');
    expect(declaredInput('staticData').type).toBe('array');
    // The schema's verdicts, each with the spelling it refuses as the control.
    expect(schemaAccepts({ data: VALUE_CONFIG }), 'ObjectGanttSchema refuses a data configuration').toBe(true);
    expect(schemaAccepts({ data: DATA_ROWS }), 'ObjectGanttSchema accepts a bare array under data').toBe(false);
    expect(schemaAccepts({ staticData: STATIC_ROWS }), 'ObjectGanttSchema refuses staticData rows').toBe(true);
    expect(schemaAccepts({ staticData: VALUE_CONFIG }), 'ObjectGanttSchema accepts an object under staticData').toBe(false);
    // The html tier says the same about the bare array.
    expect(diagnosticsOf({ data: DATA_ROWS }).map((d) => d.code)).toEqual(['type-mismatch']);
  });

  it('each description names the position it is true about', () => {
    for (const [key, phrases] of Object.entries(POSITION_PHRASES)) {
      const description: string = declaredInput(key)?.description ?? '';
      expect(description.length, `${key} publishes no description`).toBeGreaterThan(40);
      for (const phrase of phrases) {
        expect(description, `${key}'s description lost "${phrase}"`).toContain(phrase);
      }
    }
  });
});

const makeDataSource = (): DataSource =>
  ({
    find: vi.fn().mockResolvedValue({
      data: [{ id: 'f1', subject: 'F1', visible_from: '2026-01-01', due_date: '2026-01-02' }],
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ fields: {} }),
  }) as unknown as DataSource;

/** Render one node through the real `SchemaRenderer` and read what it charted. */
async function chart(node: Record<string, unknown>, expectedIds: string) {
  const dataSource = makeDataSource();
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <SchemaRenderer schema={{ type: TYPE, gantt: GANTT, ...node } as any} />
    </SchemaRendererProvider>,
  );
  // Waiting on the expected set, then reading it back, keeps a wrong answer a
  // readable diff rather than a timeout.
  await waitFor(() =>
    expect(screen.getByTestId('gantt-view').getAttribute('data-task-ids')).toBe(expectedIds),
  ).catch(() => undefined);
  const ids = screen.queryByTestId('gantt-view')?.getAttribute('data-task-ids') ?? null;
  const queried = (dataSource.find as any).mock.calls.map((call: any[]) => call[0]);
  return { ids, queried };
}

const idsOf = (rows: Array<{ id: string }>) => rows.map((r) => r.id).join(',');

describe('objectui#10394 — what the declared descriptions claim, through SchemaRenderer', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
  });

  it('data wins over staticData and objectName, and queries nothing', async () => {
    const { ids, queried } = await chart(
      { data: VALUE_CONFIG, staticData: STATIC_ROWS, objectName: 'account' },
      idsOf(DATA_ROWS),
    );
    expect(ids).toBe(idsOf(DATA_ROWS));
    expect(queried).toEqual([]);
  });

  it('staticData wins over objectName, and queries nothing', async () => {
    const { ids, queried } = await chart({ staticData: STATIC_ROWS, objectName: 'account' }, idsOf(STATIC_ROWS));
    expect(ids).toBe(idsOf(STATIC_ROWS));
    expect(queried).toEqual([]);
  });

  it('control: objectName alone is queried', async () => {
    const { ids, queried } = await chart({ objectName: 'account' }, 'f1');
    expect(ids).toBe('f1');
    expect(queried).toEqual(['account']);
  });

  it('an object provider queries its object, never objectName', async () => {
    const { ids, queried } = await chart(
      { data: { provider: 'object', object: 'task' }, objectName: 'account' },
      'f1',
    );
    expect(ids).toBe('f1');
    expect(queried).toEqual(['task']);
  });

  it('a retired api block requests nothing and is answered like an unknown provider', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const { ids, queried } = await chart(
      { data: { provider: 'api', read: { url: 'https://api.test/tasks' } }, objectName: 'account' },
      'f1',
    );
    expect(ids).toBe('f1');
    expect(queried).toEqual(['account']);
    expect(fetchSpy.mock.calls.map((call: unknown[]) => String(call[0]).split('?')[0])).not.toContain('https://api.test/tasks');
  });

  it('a bare array under data is not a record source', async () => {
    const { ids, queried } = await chart({ data: DATA_ROWS, staticData: STATIC_ROWS }, idsOf(STATIC_ROWS));
    expect(ids).toBe(idsOf(STATIC_ROWS));
    expect(queried).toEqual([]);
  });
});
