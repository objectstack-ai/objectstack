// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30237 PR 5, ADR-0148] `deleteData` names the recycle-bin entry the delete
 * wrote (`DeleteDataResponse.recycleBinEntryId`), so a client can offer to
 * undo it. The engine tells the id through `onRecycleBinEntry` once the row is
 * removed; a delete that wrote no entry answers no key, exactly as before.
 */

import { describe, it, expect, vi } from 'vitest';
// Pays `@objectstack/lint`'s first load at collection, never inside a clocked case
// (the diagnostics import it lazily).
import '@objectstack/lint';
import { assertEngineDeleteDispatch } from '@objectstack/metadata-core';
import { DeleteDataResponseSchema } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = { name: 'task', fields: { id: { name: 'id', type: 'text' } } };

function makeProtocol(entryId: string | undefined) {
  const del = vi.fn(async (_object: string, o: any) => {
    assertEngineDeleteDispatch(o);
    if (entryId !== undefined) o.onRecycleBinEntry?.(entryId);
    return true;
  });
  const engine = { registry: { getObject: (n: string) => (n === 'task' ? SCHEMA : undefined) }, delete: del };
  return { p: new ObjectStackProtocolImplementation(engine as any), del };
}

describe('[#30237] deleteData names the recycle-bin entry the delete wrote', () => {
  it('answers `recycleBinEntryId` when the engine tells one, and the answer parses against the declared schema', async () => {
    const { p, del } = makeProtocol('rb_1');
    const res: any = await p.deleteData({ object: 'task', id: 't1', context: { userId: 'u1' } } as any);
    expect(res).toEqual({ object: 'task', id: 't1', success: true, recycleBinEntryId: 'rb_1' });
    expect(DeleteDataResponseSchema.parse(res)).toEqual(res);
    expect(typeof del.mock.calls[0][1].onRecycleBinEntry).toBe('function');
  });

  it('answers no key when the delete wrote no entry', async () => {
    const { p } = makeProtocol(undefined);
    const res: any = await p.deleteData({ object: 'task', id: 't1' } as any);
    expect(res).toEqual({ object: 'task', id: 't1', success: true });
    expect(res).not.toHaveProperty('recycleBinEntryId');
  });
});
