/**
 * ObjectUI — useSchemaPersistence callable-guard pins (objectui#6658)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * The designer save door used to hand the schema straight to `JSON.stringify`,
 * which drops a function-valued property SILENTLY: `save()` resolved with the
 * id, `error` stayed null, `lastSavedAt` advanced, and the stored entry had
 * quietly lost the handler. Measured on `faac0d935` before the guard landed:
 *
 *   stored raw = {"schema":{"type":"page:list","columns":[{"name":"a"},
 *                {"name":"b"},{"name":"c"}]},"updatedAt":"..."}
 *   save() -> "repro-6658"   error -> null   lastSavedAt -> set
 *
 * Both the top-level `onSelectionChange` and the array-nested `columns[2].cell`
 * were gone, and every observable signal reported success.
 *
 * Per the 2026-08-29 maintainer ruling the door now REFUSES such a save. The
 * guard sits at the hook layer, not in the default adapter, so a host-injected
 * or REST adapter is covered too — that placement is the ruling, not a
 * preference, and the host-adapter pin below is what holds it there.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useSchemaPersistence,
  type SchemaPersistenceAdapter,
} from '../useSchemaPersistence';

const KEY = 'objectui-schema:design-1';

/** Drive `save()` through the hook and hand back the value it resolved with. */
async function drive(
  schema: Record<string, unknown>,
  adapter?: SchemaPersistenceAdapter,
  id = 'design-1',
) {
  const hook = renderHook(() => useSchemaPersistence(adapter));
  let returned: string | null | undefined;
  await act(async () => {
    returned = await hook.result.current.save(id, schema);
  });
  return { hook, returned };
}

beforeEach(() => {
  localStorage.clear();
});

describe('useSchemaPersistence — callable guard (#6658)', () => {
  // ---- pin 1: a NESTED function value is refused, loudly -------------------
  it('refuses a save whose schema carries a nested function value', async () => {
    const schema: Record<string, unknown> = {
      type: 'page:list',
      toolbar: { actions: { onExport: () => 'boom' } },
    };

    const { hook, returned } = await drive(schema);

    expect(returned).toBeNull();
    expect(hook.result.current.error).toBeInstanceOf(Error);
    // lastSavedAt untouched — the ruling's pin, and the signal that used to lie
    expect(hook.result.current.lastSavedAt).toBeNull();
    // nothing was written at all
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem('objectui-schema:__index__')).toBeNull();
  });

  it('names the exact offending key path, not just "a function was found"', async () => {
    const schema: Record<string, unknown> = {
      type: 'page:list',
      toolbar: { actions: { onExport: () => 'boom' } },
    };

    const { hook } = await drive(schema);

    expect(hook.result.current.error?.message).toContain('toolbar.actions.onExport');
  });

  it('lists EVERY offending path when a schema carries several', async () => {
    const schema: Record<string, unknown> = {
      type: 'page:list',
      onSelectionChange: () => 'a',
      detail: { onCardMove: () => 'b' },
    };

    const { hook } = await drive(schema);
    const message = hook.result.current.error?.message ?? '';

    expect(message).toContain('onSelectionChange');
    expect(message).toContain('detail.onCardMove');
    expect(message).toContain('2 function-valued');
  });

  it('names both escapes, so the error says what to DO', async () => {
    const { hook } = await drive({ onClick: () => 'x' });
    const message = hook.result.current.error?.message ?? '';

    // escape 1: strip the callables before saving
    expect(message).toContain('strip the callables before saving');
    // escape 2: use the declarative form
    expect(message).toContain('declarative form');
  });

  // ---- pin 4: a function nested inside an ARRAY element is caught too ------
  it('catches a function nested inside an array element, path spelled by index', async () => {
    const schema: Record<string, unknown> = {
      type: 'page:list',
      columns: [{ name: 'a' }, { name: 'b' }, { name: 'c', cell: () => 'x' }],
    };

    const { hook, returned } = await drive(schema);

    expect(returned).toBeNull();
    expect(hook.result.current.error?.message).toContain('columns[2].cell');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  // ---- pin 3: a HOST-INJECTED adapter is covered, not just localStorage ----
  it('refuses before a host-injected adapter is ever reached', async () => {
    // The whole reason the ruling put the guard at the hook layer: a REST or
    // host adapter has the identical `JSON.stringify` shape, so a guard living
    // in the default localStorage adapter would leave this one unprotected.
    const hostSave = vi.fn(async () => 'design-1');
    const hostAdapter: SchemaPersistenceAdapter = {
      save: hostSave,
      load: async () => null,
    };

    const { hook, returned } = await drive(
      { type: 'page:list', columns: [{ name: 'c', cell: () => 'x' }] },
      hostAdapter,
    );

    expect(hostSave).not.toHaveBeenCalled();
    expect(returned).toBeNull();
    expect(hook.result.current.error?.message).toContain('columns[0].cell');
    expect(hook.result.current.lastSavedAt).toBeNull();
  });

  it('still lets a host-injected adapter save a declarative schema', async () => {
    const hostSave = vi.fn(async () => 'design-1');
    const hostAdapter: SchemaPersistenceAdapter = {
      save: hostSave,
      load: async () => null,
    };
    const schema = { type: 'page:list', columns: [{ name: 'c' }] };

    const { hook, returned } = await drive(schema, hostAdapter);

    expect(hostSave).toHaveBeenCalledWith('design-1', schema);
    expect(returned).toBe('design-1');
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.lastSavedAt).not.toBeNull();
  });

  // ---- pin 2: a declarative schema saves EXACTLY as today ------------------
  it('saves a fully declarative schema byte-identically to the pre-guard door', async () => {
    const schema: Record<string, unknown> = {
      type: 'page:list',
      title: 'Contacts',
      columns: [{ name: 'a' }, { name: 'b', width: 120 }],
      filters: { status: ['open', 'closed'] },
    };

    const { hook, returned } = await drive(schema);

    expect(returned).toBe('design-1');
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.lastSavedAt).not.toBeNull();
    expect(hook.result.current.isDirty).toBe(false);

    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    // Byte-identical to what the pre-guard door produced: the guard must not
    // rewrite, re-order or strip anything on the way through. Rebuilt here from
    // the entry's own `updatedAt` (the only non-deterministic part).
    const entry = JSON.parse(raw as string);
    expect(raw).toBe(JSON.stringify({ schema, updatedAt: entry.updatedAt }));
    expect(entry.schema).toEqual(schema);
    // and the index the adapter maintains is untouched in shape
    expect(JSON.parse(localStorage.getItem('objectui-schema:__index__') as string)).toEqual([
      'design-1',
    ]);
  });

  it('round-trips a declarative schema through save + load unchanged', async () => {
    const schema: Record<string, unknown> = {
      type: 'page:list',
      columns: [{ name: 'a' }, { name: 'b' }],
    };

    const { hook } = await drive(schema);

    let loaded: Record<string, unknown> | null = null;
    await act(async () => {
      loaded = await hook.result.current.load('design-1');
    });

    expect(loaded).toEqual(schema);
  });

  it('does not mistake a declarative schema for a callable one (no over-broad guard)', async () => {
    // Strings that merely LOOK like handlers, plus nulls and nested empties —
    // an over-broad guard trips on these and breaks every existing flow.
    const schema: Record<string, unknown> = {
      type: 'page:list',
      onClick: 'action:submit',
      cell: { kind: 'badge' },
      empty: {},
      list: [],
      nothing: null,
      count: 0,
      flag: false,
    };

    const { hook, returned } = await drive(schema);

    expect(returned).toBe('design-1');
    expect(hook.result.current.error).toBeNull();
    expect(JSON.parse(localStorage.getItem(KEY) as string).schema).toEqual(schema);
  });

  it('does not hang on a cyclic schema before the guard can report', async () => {
    const schema: Record<string, unknown> = { type: 'page:list', onClick: () => 'x' };
    schema.self = schema;

    const { hook, returned } = await drive(schema);

    expect(returned).toBeNull();
    expect(hook.result.current.error?.message).toContain('onClick');
  });
});
