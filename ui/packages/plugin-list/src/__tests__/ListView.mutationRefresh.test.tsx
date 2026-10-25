/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Regression: ListView must refetch on `dataSource.onMutation` events EVEN when
 * an external `refreshTrigger` is provided.
 *
 * Real-world symptom (framework app-showcase): inline-edit a grid cell, click
 * "全部保存" (Save All) — the write persisted but the list did not auto-refresh.
 * ObjectView drives the grid with `refreshTrigger`, which is bumped by
 * form-success / delete handlers but NOT by inline-edit saves (ObjectGrid
 * writes those straight through `dataSource.update`). The only signal for that
 * path is `onMutation`; ListView used to skip subscribing whenever a
 * refreshTrigger was present, so inline edits never repainted.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ListView } from '../ListView';
import type { ListViewSchema } from '@object-ui/types';
import { SchemaRendererProvider } from '@object-ui/react';

beforeAll(() => {
  Object.defineProperty(window, 'localStorage', {
    value: (() => {
      let store: Record<string, string> = {};
      return {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        clear: () => { store = {}; },
        removeItem: (k: string) => { delete store[k]; },
      };
    })(),
    configurable: true,
  });
});

function makeDataSource() {
  let listeners: Array<(e: any) => void> = [];
  const find = vi.fn().mockResolvedValue({ data: [], total: 0 });
  return {
    find,
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    onMutation: (cb: (e: any) => void) => {
      listeners.push(cb);
      return () => { listeners = listeners.filter((l) => l !== cb); };
    },
    // test helper to fire an event
    __emit: (e: any) => listeners.forEach((l) => l(e)),
  } as any;
}

describe('ListView — refetch on onMutation with an external refreshTrigger', () => {
  it('refetches when the bound object is mutated even though refreshTrigger is set', async () => {
    const ds = makeDataSource();
    const schema: ListViewSchema = {
      type: 'list-view',
      objectName: 'showcase_project',
      // ObjectView always passes this for grid-driven views; it used to disable
      // the onMutation subscription.
      refreshTrigger: 0,
      fields: ['name'],
    } as any;

    render(
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={schema} dataSource={ds} />
      </SchemaRendererProvider>,
    );

    // Initial fetch(es) settle.
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const callsBefore = ds.find.mock.calls.length;

    // Simulate an inline-edit save landing on the SAME object.
    ds.__emit({ type: 'update', resource: 'showcase_project', id: 'r1' });

    await waitFor(() => {
      expect(ds.find.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('ignores mutations on a different object', async () => {
    const ds = makeDataSource();
    const schema: ListViewSchema = {
      type: 'list-view',
      objectName: 'showcase_project',
      refreshTrigger: 0,
      fields: ['name'],
    } as any;

    render(
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={schema} dataSource={ds} />
      </SchemaRendererProvider>,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const callsBefore = ds.find.mock.calls.length;

    ds.__emit({ type: 'update', resource: 'some_other_object', id: 'x' });

    // Give any (unwanted) refetch a chance to fire, then assert none did.
    await new Promise((r) => setTimeout(r, 50));
    expect(ds.find.mock.calls.length).toBe(callsBefore);
  });
});
