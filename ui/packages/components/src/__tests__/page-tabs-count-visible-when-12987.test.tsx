/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12987 — `page:tabs` derives a tab's badge by summing the
 * `record:related_list` nodes under it. A list whose own `visibleWhen` is false
 * for the viewer is not drawn by the tab body, so it is not counted either.
 *
 * The gate is decided the way the tab body decides it: `SchemaRenderer`'s
 * evaluator, over the row bound as `record`, `user` / `current_user` and page
 * variables as `page`. The badge is read through its accessible name, the one
 * the strip renders for every derived count.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { RecordContextProvider, SchemaRenderer } from '@object-ui/react';
import { RelatedCountStore } from '../hooks/related-count-store';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout` (objectui#3010/#3021).
import '../renderers';

const RECORD_OBJECT = 'zz12987_env';
const PARENT_ID = 'ENV-1';
const HIDDEN_CHILD = 'zz12987_domain';
const SHOWN_CHILD = 'zz12987_member';

/** Rows per child object: the badge is the sum of the counted lists. */
const TOTALS: Record<string, number> = { [HIDDEN_CHILD]: 3, [SHOWN_CHILD]: 2 };

const makeDS = () => ({
  find: vi.fn(async (object: string) => ({ data: [], total: TOTALS[object] ?? 0 })),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
});

const relatedList = (objectName: string, visibleWhen?: unknown) => ({
  type: 'record:related_list',
  ...(visibleWhen === undefined ? {} : { visibleWhen }),
  properties: { objectName, relationshipField: 'environment' },
});

/** Two tabs minimum — the strip hides itself at length 1. */
const tabsSchema = (overview: Record<string, unknown>) => ({
  type: 'page:tabs',
  id: 'tabs-12987',
  items: [
    { label: 'Details', value: 'details', children: [{ type: 'element:text', properties: { content: 'DETAILS' } }] },
    { label: 'Overview', value: 'overview', ...overview },
  ],
});

const PRO_ONLY = "record.plan == 'pro'";

function renderTabs(plan: string, overview: Record<string, unknown>) {
  const ds = makeDS();
  const utils = render(
    <RecordContextProvider
      objectName={RECORD_OBJECT}
      recordId={PARENT_ID}
      data={{ id: PARENT_ID, plan }}
      dataSource={ds as any}
    >
      <SchemaRenderer schema={tabsSchema(overview) as any} />
    </RecordContextProvider>,
  );
  return { ...utils, ds };
}

const probedObjects = (ds: ReturnType<typeof makeDS>) =>
  Array.from(new Set(ds.find.mock.calls.map((c) => c[0] as string))).sort();

beforeEach(() => RelatedCountStore._reset());
afterEach(() => {
  cleanup();
  RelatedCountStore._reset();
});

describe('page:tabs derived count skips a related list its own visibleWhen hides (objectui#12987)', () => {
  it.each([
    ['a bare predicate', PRO_ONLY],
    ['a CEL envelope', { dialect: 'cel', source: PRO_ONLY }],
  ])('counts only the shown list when the other is hidden, for %s', async (_label, gate) => {
    const { findByLabelText, queryByLabelText, ds } = renderTabs('free', {
      children: [relatedList(HIDDEN_CHILD, gate), relatedList(SHOWN_CHILD)],
    });

    expect((await findByLabelText('2 items')).textContent).toBe('2');
    expect(queryByLabelText('5 items')).toBeNull();
    expect(probedObjects(ds)).toEqual([SHOWN_CHILD]);
  });

  it('CONTROL: counts both lists when both are shown', async () => {
    const { findByLabelText, ds } = renderTabs('pro', {
      children: [relatedList(HIDDEN_CHILD, PRO_ONLY), relatedList(SHOWN_CHILD)],
    });

    expect((await findByLabelText('5 items')).textContent).toBe('5');
    expect(probedObjects(ds)).toEqual([HIDDEN_CHILD, SHOWN_CHILD].sort());
  });

  it('CONTROL: an authored count wins over the derived one', async () => {
    const { findByLabelText, ds } = renderTabs('free', {
      count: 7,
      children: [relatedList(HIDDEN_CHILD, PRO_ONLY), relatedList(SHOWN_CHILD)],
    });

    expect((await findByLabelText('7 items')).textContent).toBe('7');
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('skips a list below a container whose visibleWhen hides it', async () => {
    const { findByLabelText, ds } = renderTabs('free', {
      children: [
        { type: 'page:card', visibleWhen: PRO_ONLY, children: [relatedList(HIDDEN_CHILD)] },
        relatedList(SHOWN_CHILD),
      ],
    });

    expect((await findByLabelText('2 items')).textContent).toBe('2');
    expect(probedObjects(ds)).toEqual([SHOWN_CHILD]);
  });

  it('skips a list whose visibleWhen cannot be evaluated, as the body withholds it (fail-closed, objectui#13299)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { findByLabelText, queryByLabelText } = renderTabs('free', {
        children: [relatedList(HIDDEN_CHILD, 'record.plan ==== )('), relatedList(SHOWN_CHILD)],
      });

      expect((await findByLabelText('2 items')).textContent).toBe('2');
      expect(queryByLabelText('5 items')).toBeNull();
    } finally {
      warn.mockRestore();
    }
  });

  it('drops the list from the badge when its gate closes on a later render', async () => {
    const overview = { children: [relatedList(HIDDEN_CHILD, PRO_ONLY), relatedList(SHOWN_CHILD)] };
    const { findByLabelText, rerender, ds } = renderTabs('pro', overview);
    await findByLabelText('5 items');

    rerender(
      <RecordContextProvider
        objectName={RECORD_OBJECT}
        recordId={PARENT_ID}
        data={{ id: PARENT_ID, plan: 'free' }}
        dataSource={ds as any}
      >
        <SchemaRenderer schema={tabsSchema(overview) as any} />
      </RecordContextProvider>,
    );

    await waitFor(() => expect(findByLabelText('2 items')).resolves.toBeTruthy());
  });
});
