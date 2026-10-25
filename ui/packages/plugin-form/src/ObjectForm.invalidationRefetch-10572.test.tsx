/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10572 — an `object-form` in edit mode re-reads its record on the
 * data-invalidation bus (`notifyDataChanged` from `@object-ui/react`), GATED ON
 * PRISTINE (the seat's ruling on the card's fork, option A).
 *
 * Measured before the gate: a bare re-read overwrote a dirty field — through
 * the loading branch (the form unmounted) and, without it, through the form
 * renderer's by-value reset to the new `defaultValues` — and advanced the OCC
 * token a save sends. So:
 *   (a) a pristine form re-reads in place, 1 → 2 reads, same input node;
 *   (b) a dirty form HOLDS the change: the typed value stays on screen and the
 *       save still sends the `ifMatch` the edit started from;
 *   (c) once that edit is saved — or reverted to pristine — exactly one held
 *       re-read is replayed;
 *   (d) a change scoped to another record of the object reads nothing.
 * (b) runs on both the flat and the sectioned render paths.
 *
 * Rendered through the real `SchemaRenderer` and this package's registration,
 * over a fake data source whose record moves on the server.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent, screen } from '@testing-library/react';
import { SchemaRenderer, SchemaRendererProvider, notifyDataChanged } from '@object-ui/react';
// Registers `object-form`.
import './index';

beforeEach(() => {
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const settle = (ms = 150) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

/** A server holding one `deal` record whose name and version can move. */
function makeServer() {
  const record = { id: '1', name: 'Server v1', note: 'n1', updated_at: '2026-01-01T00:00:00.000Z' };
  const ds = {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => ({ ...record })),
    create: vi.fn(),
    update: vi.fn(async (_object: string, _id: string, data: Record<string, unknown>) => {
      Object.assign(record, data, { updated_at: '2026-01-03T00:00:00.000Z' });
      return { ...record };
    }),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({
      name: 'deal',
      fields: { name: { type: 'text', label: 'Name' }, note: { type: 'text', label: 'Note' } },
    })),
  };
  /** Another writer moves the record on the server. */
  const moveOnServer = () => {
    record.name = 'Server v2';
    record.updated_at = '2026-01-02T00:00:00.000Z';
  };
  return { ds, moveOnServer };
}

const FLAT = { type: 'object-form', objectName: 'deal', mode: 'edit', recordId: '1' };
const SECTIONED = { ...FLAT, sections: [{ label: 'Main', fields: ['name', 'note'] }] };

const renderForm = (schema: Record<string, unknown>, ds: ReturnType<typeof makeServer>['ds']) =>
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <SchemaRenderer schema={schema as any} />
    </SchemaRendererProvider>,
  );

const nameInput = () => document.querySelector('input[name="name"]') as HTMLInputElement;

async function mountEditForm(schema: Record<string, unknown> = FLAT) {
  const server = makeServer();
  renderForm(schema, server.ds);
  await settle(400);
  expect(nameInput().value).toBe('Server v1');
  expect(server.ds.findOne).toHaveBeenCalledTimes(1);
  return server;
}

async function type(value: string) {
  fireEvent.change(nameInput(), { target: { value } });
  await settle();
}

async function bus(change: { objectName: string; recordId?: string }) {
  await act(async () => {
    notifyDataChanged(change);
  });
  await settle();
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
  });
  await settle(300);
}

describe('object-form edit mode re-reads on the bus, gated on pristine (objectui#10572)', () => {
  it('(a) a pristine form re-reads in place: 1 → 2 reads, the same input shows the new value', async () => {
    const { ds, moveOnServer } = await mountEditForm();
    const before = nameInput();
    moveOnServer();

    await bus({ objectName: '*' });

    expect(ds.findOne, 'a pristine form never re-read after the bus reported a change').toHaveBeenCalledTimes(2);
    expect(nameInput().value).toBe('Server v2');
    expect(nameInput(), 'the re-read went through the loading branch and remounted the form').toBe(before);
  });

  for (const [path, schema] of [['flat', FLAT], ['sectioned', SECTIONED]] as const) {
    it(`(b) ${path}: a dirty form holds the change — the typed value stays and the save sends the original token`, async () => {
      const { ds, moveOnServer } = await mountEditForm(schema);
      await type('User typed');
      moveOnServer();

      await bus({ objectName: 'deal', recordId: '1' });

      expect(nameInput().value, 'the bus event overwrote a dirty field').toBe('User typed');
      expect(ds.findOne, 'a dirty form re-read while it held unsaved input').toHaveBeenCalledTimes(1);

      await save();
      expect(ds.update).toHaveBeenCalledTimes(1);
      const [, , payload, options] = ds.update.mock.calls[0] as unknown as [string, string, Record<string, unknown>, { ifMatch?: string }];
      expect(payload.name).toBe('User typed');
      expect(options?.ifMatch, 'the held change advanced the OCC token under the dirty edit').toBe('2026-01-01T00:00:00.000Z');
    });
  }

  it('(c) after the dirty edit is saved, exactly one held re-read is replayed', async () => {
    const { ds, moveOnServer } = await mountEditForm();
    await type('User typed');
    moveOnServer();
    await bus({ objectName: '*' });
    await bus({ objectName: 'deal' });
    expect(ds.findOne).toHaveBeenCalledTimes(1);

    await save();

    expect(ds.findOne, 'two held changes are replayed as ONE re-read after the save').toHaveBeenCalledTimes(2);
    expect(nameInput().value).toBe('User typed');
  });

  it('(c) after the dirty edit is reverted to pristine, exactly one held re-read is replayed', async () => {
    const { ds, moveOnServer } = await mountEditForm();
    await type('User typed');
    moveOnServer();
    await bus({ objectName: '*' });
    expect(ds.findOne).toHaveBeenCalledTimes(1);

    await type('Server v1');

    expect(ds.findOne, 'the held change was not replayed when the form returned to pristine').toHaveBeenCalledTimes(2);
    expect(nameInput().value).toBe('Server v2');
  });

  it('(d) a change scoped to another record of the object reads nothing', async () => {
    const { ds } = await mountEditForm();

    await bus({ objectName: 'deal', recordId: '2' });
    await bus({ objectName: 'some_other_object' });

    expect(ds.findOne).toHaveBeenCalledTimes(1);
  });
});
