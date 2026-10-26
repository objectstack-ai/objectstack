/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7928 — what the renderer does with the two named-view members whose
 * PROTOCOL type is wider than the one `NamedListView` declared.
 *
 * `ObjectViewSchema.listViews` is the protocol's `ObjectListViewSchema` record
 * by reference, so the contract now accepts what that schema accepts. Two
 * members of it are wider than the local shape `ObjectView` was typed off, and
 * the by-reference type surfaced both:
 *
 *  - `label` is the protocol's `I18nLabel`, a plain string OR an inline locale
 *    map. The tab strip rendered it raw, so a map threw "Objects are not valid
 *    as a React child". Measured on the flipped tree before the fix. A shape the
 *    contract declares has to render, so the tab strip resolves it now, the way
 *    `ListView` resolves its own `label`.
 *  - `sort` still admits the bare string clause objectui retired
 *    (objectui#8221). That is the protocol's own divergence, and the renderer's
 *    answer to it is unchanged: the value reaches the sort sink as written and
 *    is refused out loud, with no `$orderby`. It is pinned here so that answer
 *    is a reading and not an assumption.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

vi.mock('@object-ui/react', async (importOriginal) => {
  const ReactMod = await import('react');
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ schema }: any) => <div data-testid="schema-renderer">{schema?.type}</div>,
    SchemaRendererContext: ReactMod.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));

const dataSource = (): any => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn().mockResolvedValue({ name: 'task', fields: {} }),
});

const node = (listViews: Record<string, unknown>) =>
  ({ type: 'object-view', objectName: 'task', listViews } as unknown as ObjectViewSchema);

beforeEach(() => cleanup());
afterEach(() => vi.restoreAllMocks());

describe('objectui#7928 — a named view\'s `I18nLabel` renders on the tab strip', () => {
  it('a locale-map label renders as one of its entries, and does not throw', async () => {
    const { findAllByRole } = render(
      <ObjectView
        schema={node({
          v1: { label: { en: 'All deals', zh: 'ZH deals' }, type: 'grid', columns: ['name'] },
          v2: { label: 'Other', type: 'grid', columns: ['name'] },
        })}
        dataSource={dataSource()}
      />,
    );
    const tabs = (await findAllByRole('tab')).map((t) => t.textContent);
    expect(tabs).toContain('Other');
    const first = tabs.find((t) => t !== 'Other');
    expect(['All deals', 'ZH deals']).toContain(first);
  });

  it('CONTROL: plain-string labels render unchanged — the rung the fix did not touch', async () => {
    const { findAllByRole } = render(
      <ObjectView
        schema={node({
          v1: { label: 'My Deals', type: 'grid', columns: ['name'] },
          v2: { label: 'Other', type: 'grid', columns: ['name'] },
        })}
        dataSource={dataSource()}
      />,
    );
    const tabs = (await findAllByRole('tab')).map((t) => t.textContent);
    expect(tabs).toEqual(['My Deals', 'Other']);
  });

  it('a map with no usable entry resolves to nothing and falls through to `name`, then the record key', async () => {
    const { findAllByRole } = render(
      <ObjectView
        schema={node({
          v1: { label: {}, name: 'named_view', type: 'grid', columns: ['name'] },
          v2: { label: {}, type: 'grid', columns: ['name'] },
        })}
        dataSource={dataSource()}
      />,
    );
    const tabs = (await findAllByRole('tab')).map((t) => t.textContent);
    expect(tabs).toEqual(['named_view', 'v2']);
  });
});

describe('objectui#7928 — a named view\'s retired string `sort` is refused out loud, not lowered', () => {
  it('the non-grid fetch carries no `$orderby`, and the sink reports the refusal', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ds = dataSource();
    render(
      <ObjectView
        schema={node({ v1: { label: 'Board', type: 'kanban', columns: ['name'], kanban: { groupByField: 'stage', columns: ['name'] }, sort: 'zzq_created desc' } })}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const params = ds.find.mock.calls[0][1] ?? {};
    expect(params.$orderby).toBeUndefined();
    expect(errors.mock.calls.some((c) => String(c[0]).includes('zzq_created desc'))).toBe(true);
  });

  it('CONTROL: the array form orders the same fetch', async () => {
    const ds = dataSource();
    render(
      <ObjectView
        schema={node({ v1: { label: 'Board', type: 'kanban', columns: ['name'], kanban: { groupByField: 'stage', columns: ['name'] }, sort: [{ field: 'zzq_created', order: 'desc' }] } })}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(ds.find.mock.calls[0][1]?.$orderby).toEqual({ zzq_created: 'desc' });
  });
});
