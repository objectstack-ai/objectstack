// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#6037 / #4633 ruling D] `validateData` — the DataProtocol's validate-only
// operation.
//
// The ruling attached one clause to this operation specifically: DECLARATION
// AND EXECUTION MUST LAND TOGETHER. `BatchOptions.validateOnly` was retired in
// #4052 as a dry-run flag that "promised a dry-run" while every batch surface
// persisted regardless, so a caller previewing a mutation had it EXECUTED.
// These cases are what stops the new operation becoming the same thing: they
// assert it is wired to the engine's verdict rather than declared beside one.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';

const SCHEMA = {
  name: 'lead',
  fields: {
    company: { name: 'company', type: 'text', required: true },
    email: { name: 'email', type: 'email' },
  },
};

/** An engine whose `validate` records how it was called. */
function makeEngine(verdict?: any) {
  return {
    registry: { getObject: (n: string) => (n === 'lead' ? SCHEMA : undefined) },
    getObject: (n: string) => (n === 'lead' ? SCHEMA : undefined),
    validate: vi.fn(async (object: string, _data: any, options?: any) => verdict ?? {
      object,
      mode: options?.mode ?? 'insert',
      valid: true,
      results: [{ valid: true, errors: [], warnings: [] }],
      posture: { valueShapeStrict: false, mediaValueShapeStrict: false },
    }),
    // Every write the operation must never reach.
    insert: vi.fn(async () => { throw new Error('validateData must not write'); }),
    update: vi.fn(async (_o: string, data: any, options?: any) => {
      assertEngineUpdateDispatch(data, options);
      throw new Error('validateData must not write');
    }),
    delete: vi.fn(async (_o: string, options?: any) => {
      assertEngineDeleteDispatch(options);
      throw new Error('validateData must not write');
    }),
  };
}

describe('validateData (#6037)', () => {
  it('returns the ENGINE’s verdict rather than a verdict of its own', async () => {
    const verdict = {
      object: 'lead',
      mode: 'insert',
      valid: false,
      results: [{
        valid: false,
        errors: [{ field: 'company', code: 'required', message: 'company is required' }],
        warnings: [],
      }],
      posture: { valueShapeStrict: true, mediaValueShapeStrict: false },
    };
    const engine = makeEngine(verdict);
    const p = new ObjectStackProtocolImplementation(engine as any);
    const res: any = await p.validateData({ object: 'lead', data: { email: 'a@b.com' } });
    // Passed through, not re-derived: a protocol layer that re-judged would be
    // the hand-copied mirror this operation exists to retire.
    expect(res).toEqual(verdict);
    expect(engine.validate).toHaveBeenCalledTimes(1);
  });

  it('never touches a write path', async () => {
    const engine = makeEngine();
    const p = new ObjectStackProtocolImplementation(engine as any);
    await p.validateData({ object: 'lead', data: [{ company: 'Acme' }, { company: 'Globex' }] });
    expect(engine.insert).not.toHaveBeenCalled();
    expect(engine.update).not.toHaveBeenCalled();
    expect(engine.delete).not.toHaveBeenCalled();
  });

  it('forwards `mode` and `context` to the engine, and omits them when unset', async () => {
    const engine = makeEngine();
    const p = new ObjectStackProtocolImplementation(engine as any);

    await p.validateData({ object: 'lead', data: {}, mode: 'update', context: { userId: 'u1' } });
    expect(engine.validate).toHaveBeenLastCalledWith('lead', {}, { mode: 'update', context: { userId: 'u1' } });

    // Absent keys are not forwarded as `undefined` — the engine's own defaults
    // decide, so a caller that omits `mode` gets `insert` from one place.
    await p.validateData({ object: 'lead', data: {} });
    expect(engine.validate).toHaveBeenLastCalledWith('lead', {}, {});
  });

  it('rejects an unknown object the same way every other data entry point does (#3770)', async () => {
    const engine = makeEngine();
    const p = new ObjectStackProtocolImplementation(engine as any);
    // A preview that 404s differently from its write would be a mirror again.
    await expect(p.validateData({ object: 'nope', data: {} })).rejects.toThrow();
    expect(engine.validate).not.toHaveBeenCalled();
  });

  it('is declared on the protocol surface it claims (the #4052 non-repeat)', async () => {
    const p = new ObjectStackProtocolImplementation(makeEngine() as any);
    expect(typeof (p as any).validateData).toBe('function');
  });
});
