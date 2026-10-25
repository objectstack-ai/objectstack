/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#7118 — `record:related_list.filter` reaches the query.
 *
 * The spec declares `RecordRelatedListProps.filter` ("Additional filter criteria
 * for related records") and this repo published it as a registry input; nothing
 * read it. `RelatedList` built its query from `{ [referenceField]: parentId }`
 * alone, so an author who wrote `filter` got EVERY child of the parent — no
 * error, `os validate` green, the SDUI prop walk green (a declared key raises no
 * `unknown-prop`), and a list wider than the metadata asked for. Same shape as
 * objectstack#4413: declared, validated, unconsumed.
 *
 * Both directions are pinned here, and the second is the one that keeps the fix
 * honest: with nothing authored the query must stay the object it always was
 * (`{ account: 'ACC-1' }`), not a freshly lowered AST that happens to mean the
 * same thing — the difference is invisible on screen and visible to every caller
 * that pins the wire.
 *
 * The composition itself is not re-litigated here (that is #5576's suite): what
 * this file pins is that the value ARRIVES, that the parent scope survives it,
 * and that it goes through the repo's single filter sink rather than a private
 * conversion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockInstance } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { RelatedList } from '../RelatedList';

const rows = [{ id: 'c1', name: 'Alice' }];

const makeDS = () => ({
  find: vi.fn(async () => rows),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
});

/** The parent-scoped list a related list always is; only `filter` varies. */
const renderList = (ds: any, extra: Record<string, any> = {}) =>
  render(
    <RelatedList
      title="Contacts"
      type="table"
      api="contact"
      objectName="contact"
      referenceField="account"
      parentId="ACC-1"
      dataSource={ds as any}
      {...extra}
    />,
  );

/** The spec's own authoring vocabulary for this key. */
const WON = [{ field: 'stage', operator: 'equals' as const, value: 'won' }];

describe('RelatedList — the list’s own filter reaches the query (objectstack#7118)', () => {
  it('ANDs an authored `ViewFilterRule[]` with the parent relationship', async () => {
    const ds = makeDS();
    renderList(ds, { filter: WON });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    // Parent scope FIRST and never negotiable — "additional" criteria may only
    // narrow this parent's children. The rule array is lowered to ObjectQL nodes
    // by the shared sink (`toFilterNode`), which is why `equals` survives as
    // written instead of being re-spelled by a local conversion.
    expect(ds.find).toHaveBeenCalledWith('contact', {
      $filter: ['and', ['account', '=', 'ACC-1'], [['stage', 'equals', 'won']]],
    });
  });

  it('sends the parent scope UNCHANGED when nothing is authored', async () => {
    const ds = makeDS();
    renderList(ds);
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    // Byte-for-byte the pre-#7118 query — a MongoDB-style object, not an AST.
    expect(ds.find).toHaveBeenCalledWith('contact', { $filter: { account: 'ACC-1' } });
  });

  it('treats an empty `filter: []` as unauthored, like the designer emits it', async () => {
    const ds = makeDS();
    renderList(ds, { filter: [] });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(ds.find).toHaveBeenCalledWith('contact', { $filter: { account: 'ACC-1' } });
  });

  it('accepts the AST node `ElementDataSourceGate` composes, without converting it twice', async () => {
    const ds = makeDS();
    // What a `dataSource: { object, view, filter }` binding leaves on this key:
    // the view's filter and the binding's, already ANDed by the shared layer.
    const composed = ['and', [['is_active', '=', true]], [['x', '=', 1]]];
    renderList(ds, { filter: composed });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(ds.find).toHaveBeenCalledWith('contact', {
      $filter: ['and', ['account', '=', 'ACC-1'], composed],
    });
  });

  it('carries the filter on the windowed (server-paged) fetch too', async () => {
    const ds = makeDS();
    renderList(ds, { filter: WON, pageSize: 5, defaultSort: '-created' });
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(ds.find).toHaveBeenCalledWith('contact', {
      $filter: ['and', ['account', '=', 'ACC-1'], [['stage', 'equals', 'won']]],
      $top: 5,
      $skip: 0,
      $orderby: [{ field: 'created', order: 'desc' }],
    });
  });
});

describe('RelatedList — a filter the raw-URL fallback cannot express (objectstack#7118)', () => {
  // Typed at the spied method — see `RelatedList.addPickerGuard.test.tsx` for
  // why the bare generic form erases the call signature.
  let warn: MockInstance<typeof console.warn>;
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn(async () => ({ json: async () => rows }) as any);
    globalThis.fetch = fetchMock as any;
  });

  afterEach(() => {
    warn.mockRestore();
    globalThis.fetch = originalFetch;
  });

  it('refuses to fetch rather than answering wider than the metadata asked', async () => {
    // No adapter, so the legacy `filter[<field>]=<value>` querystring is the only
    // channel — it cannot carry an operator, let alone a rule array. Dropping the
    // authored filter here would silently widen the answer, which is the class
    // this whole card removes; empty-and-loud is the same posture the unscoped
    // fetch guard already takes.
    renderList(undefined, { filter: WON });
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('declares a filter');
  });

  it('leaves the fallback path itself untouched when no filter is authored', async () => {
    renderList(undefined);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0][0])).toBe('contact?filter%5Baccount%5D=ACC-1');
  });
});
