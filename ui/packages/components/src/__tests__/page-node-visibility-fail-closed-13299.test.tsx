/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13299 — a page node whose declared `visibleWhen` FAULTS is withheld
 * by `SchemaRenderer` (fail-closed), so the `page:tabs` count-probe gate that
 * mirrors it closes too: a badge counts what is drawn.
 *
 * Rows:
 *  (e) the tab badge does not count a related list withheld by a faulting
 *      gate, on the list itself or on a container above it; an over-budget
 *      source is one such fault;
 *  (f) CONTROL — a form FIELD `visibleWhen` that faults is still drawn: form
 *      field rules keep their documented fail-open.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import {
  RecordContextProvider,
  SchemaRenderer,
  UNRESOLVABLE_VISIBILITY_PREFIX,
  __resetVisibilityPredicateWarnings,
} from '@object-ui/react';
import { RelatedCountStore } from '../hooks/related-count-store';
// Module-scope import (not `beforeAll`) — objectui#3010/#3021.
import '../renderers';

const RECORD_OBJECT = 'zz13299_env';
const PARENT_ID = 'ENV-13299';
const WITHHELD_CHILD = 'zz13299_domain';
const SHOWN_CHILD = 'zz13299_member';
const TOTALS: Record<string, number> = { [WITHHELD_CHILD]: 3, [SHOWN_CHILD]: 2 };

const makeDS = () => ({
  find: vi.fn(async (object: string) => ({ data: [], total: TOTALS[object] ?? 0 })),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
});

const cel = (source: string) => ({ dialect: 'cel', source });
const orChain = (n: number) => Array.from({ length: n }, (_, i) => `${i} == ${i}`).join(' || ');

const relatedList = (objectName: string, visibleWhen?: unknown) => ({
  type: 'record:related_list',
  ...(visibleWhen === undefined ? {} : { visibleWhen }),
  properties: { objectName, relationshipField: 'environment' },
});

/** Two tabs minimum — the strip hides itself at length 1. */
const tabsSchema = (overview: Record<string, unknown>) => ({
  type: 'page:tabs',
  id: 'tabs-13299',
  items: [
    { label: 'Details', value: 'details', children: [{ type: 'element:text', properties: { content: 'DETAILS' } }] },
    { label: 'Overview', value: 'overview', ...overview },
  ],
});

function renderTabs(overview: Record<string, unknown>) {
  const ds = makeDS();
  const utils = render(
    <RecordContextProvider
      objectName={RECORD_OBJECT}
      recordId={PARENT_ID}
      data={{ id: PARENT_ID, plan: 'free' }}
      dataSource={ds as any}
    >
      <SchemaRenderer schema={tabsSchema(overview) as any} />
    </RecordContextProvider>,
  );
  return { ...utils, ds };
}

const probedObjects = (ds: ReturnType<typeof makeDS>) =>
  Array.from(new Set(ds.find.mock.calls.map((c) => c[0] as string))).sort();

type WarnSpy = { mock: { calls: unknown[][] } };
const reports = (warn: WarnSpy): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX));

beforeEach(() => {
  RelatedCountStore._reset();
  __resetVisibilityPredicateWarnings();
});
afterEach(() => {
  cleanup();
  RelatedCountStore._reset();
  vi.restoreAllMocks();
});

describe('objectui#13299 (e) — the tab badge does not count a node withheld by a faulting gate', () => {
  it.each([
    ['an unbound root on the list', relatedList(WITHHELD_CHILD, 'nosuchroot13299e.x > 1')],
    ['an over-budget CEL source on the list', relatedList(WITHHELD_CHILD, cel(orChain(120)))],
    [
      'a faulting gate on a container above the list',
      { type: 'page:card', visibleWhen: cel('record.plan =='), children: [relatedList(WITHHELD_CHILD)] },
    ],
  ])('%s', async (_label, withheld) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { findByLabelText, queryByLabelText, ds } = renderTabs({
      children: [withheld, relatedList(SHOWN_CHILD)],
    });

    expect((await findByLabelText('2 items')).textContent).toBe('2');
    expect(queryByLabelText('5 items')).toBeNull();
    expect(probedObjects(ds)).toEqual([SHOWN_CHILD]);
    // One authored predicate, one line — and it says the node was withheld.
    const lines = reports(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('WITHHELD');
  });

  it('CONTROL: a gate that evaluates to true is counted', async () => {
    const { findByLabelText, ds } = renderTabs({
      children: [relatedList(WITHHELD_CHILD, cel("record.plan == 'free'")), relatedList(SHOWN_CHILD)],
    });

    expect((await findByLabelText('5 items')).textContent).toBe('5');
    expect(probedObjects(ds)).toEqual([WITHHELD_CHILD, SHOWN_CHILD].sort());
  });

  it('CONTROL: a blank gate declares nothing and is counted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { findByLabelText } = renderTabs({
      children: [relatedList(WITHHELD_CHILD, ''), relatedList(SHOWN_CHILD)],
    });

    expect((await findByLabelText('5 items')).textContent).toBe('5');
  });
});

describe('objectui#13299 (f) — CONTROL: a form field rule keeps its fail-open', () => {
  it('a field whose `visibleWhen` faults is still drawn', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const Form = ComponentRegistry.get('form')!;
    render(
      <Form
        schema={{
          type: 'form',
          showSubmit: false,
          showCancel: false,
          fields: [
            { name: 'subject', label: 'Subject', type: 'input' },
            { name: 'notes', label: 'Notes', type: 'input', visibleWhen: 'nosuchroot13299f.x > 1' },
          ],
        }}
      />,
    );
    expect(screen.getByLabelText(/^subject/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^notes/i)).toBeInTheDocument();
  });
});
