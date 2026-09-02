// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14088 — the provenance recorder itself, at the unit.
//
// The engine-level suite (`engine-readonly-strip-caller-values.test.ts`, the
// `#14088` describe) pins what a caller and a hook observe. This one pins the
// two properties that make the whole repair safe, where they are decidable
// without a write path in the way:
//
//   1. a key enters the record ONLY through an assignment executed against the
//      payload — never through its contents, and never through a caller's echo;
//   2. the record is FROZEN at the seal, and the seal hands back the RAW object
//      so nothing engine-owned is ever attributed to a hook.
//
// Property 1 is the forgery boundary. A key in this set is a key the read-only
// strip stops defending, so "can caller data reach it?" is the question that
// decides whether this is a fix or a privilege escalation.

import { describe, it, expect } from 'vitest';
import { recordHookPayloadWrites } from './hook-write-provenance.js';

describe('recordHookPayloadWrites (#14088)', () => {
  it('records a plain assignment, and writes through to the target', () => {
    const target: Record<string, unknown> = { title: 'T', completed_at: null };
    const rec = recordHookPayloadWrites(target);

    rec.payload.completed_at = null; // the same value that is already there

    const sealed = rec.seal(rec.payload);
    expect(sealed.data).toBe(target);
    expect([...(sealed.hookWrittenKeys ?? [])]).toEqual(['completed_at']);
    expect(target.completed_at).toBeNull();
  });

  it('⛔ THE FORGERY BOUNDARY: the caller\'s CONTENTS put nothing in the record', () => {
    // Everything a caller controls arrives as data on the object BEFORE the
    // recorder is armed. Echoing a key, echoing a value, sending `null`,
    // sending nested objects — none of it is an assignment, so the record is
    // empty and the strip's own two-part test decides every key, unchanged.
    const target: Record<string, unknown> = {
      updated_by: 'attacker', created_by: 'attacker',
      completed_at: null, elapsed_minutes: 0, flag: false, note: '',
      nested: { x: 1 }, arr: [1, 2],
    };
    const rec = recordHookPayloadWrites(target);

    // Every read shape a hook (or the engine) performs, none of them a write.
    void Object.keys(rec.payload);
    void JSON.stringify(rec.payload);
    void { ...rec.payload };
    void ('updated_by' in rec.payload);
    void Object.entries(rec.payload);
    (rec.payload.nested as Record<string, unknown>).x = 2; // in-place, on a CHILD

    expect([...(rec.seal(rec.payload).hookWrittenKeys ?? [])]).toEqual([]);
  });

  it('records `Object.defineProperty` too — the second write verb', () => {
    const target: Record<string, unknown> = { completed_at: null };
    const rec = recordHookPayloadWrites(target);

    Object.defineProperty(rec.payload, 'completed_at', {
      value: null, writable: true, enumerable: true, configurable: true,
    });

    expect([...(rec.seal(rec.payload).hookWrittenKeys ?? [])]).toEqual(['completed_at']);
  });

  it('a delete removes the key from the record; a later assignment puts it back', () => {
    const target: Record<string, unknown> = { completed_at: null };
    const rec = recordHookPayloadWrites(target);

    rec.payload.completed_at = 'x';
    delete rec.payload.completed_at;
    expect(target).not.toHaveProperty('completed_at');

    const rec2 = recordHookPayloadWrites({ completed_at: null } as Record<string, unknown>);
    rec2.payload.completed_at = 'x';
    delete rec2.payload.completed_at;
    rec2.payload.completed_at = null;

    expect([...(rec.seal(rec.payload).hookWrittenKeys ?? [])]).toEqual([]);
    expect([...(rec2.seal(rec2.payload).hookWrittenKeys ?? [])]).toEqual(['completed_at']);
  });

  it('symbol keys are not field names and never enter the record', () => {
    const target: Record<string, unknown> = {};
    const rec = recordHookPayloadWrites(target);
    const stash = Symbol('stash');

    (rec.payload as any)[stash] = 1;

    expect([...(rec.seal(rec.payload).hookWrittenKeys ?? [])]).toEqual([]);
    expect((target as any)[stash]).toBe(1);
  });

  it('the seal FREEZES the record — a later write cannot grow it', () => {
    // The seal is what keeps engine-owned passes (secret encryption,
    // multi-value normalisation, the strips) from being attributed to a hook.
    // A hook that stashed the view and writes to it afterwards must not be able
    // to reopen the record either.
    const target: Record<string, unknown> = {};
    const rec = recordHookPayloadWrites(target);
    rec.payload.a = 1;

    const sealed = rec.seal(rec.payload);
    rec.payload.b = 2;

    expect([...(sealed.hookWrittenKeys ?? [])]).toEqual(['a']);
    expect(target.b).toBe(2); // still a write-through view, just no longer recorded
  });

  it('KNOWN LIMIT: a REPLACED payload yields NO record — undefined, not empty', () => {
    // `undefined` and `new Set()` mean opposite things to the strip: the first
    // says "this call cannot say, fall back to the value test", the second says
    // "no hook wrote anything, strip freely". Conflating them is how a
    // replacement's keys would become hook-owned, which is the escalation.
    const target: Record<string, unknown> = { completed_at: null };
    const rec = recordHookPayloadWrites(target);
    rec.payload.completed_at = null;

    const replacement = { ...target, completed_at: null };
    const sealed = rec.seal(replacement);

    expect(sealed.hookWrittenKeys).toBeUndefined();
    expect(sealed.data).toBe(replacement);
  });

  it('the view is transparent for every read shape', () => {
    const target: Record<string, unknown> = { id: 'r1', title: 'T', completed_at: null };
    const rec = recordHookPayloadWrites(target);

    expect(Object.keys(rec.payload)).toEqual(['id', 'title', 'completed_at']);
    expect({ ...rec.payload }).toEqual(target);
    expect(JSON.stringify(rec.payload)).toBe(JSON.stringify(target));
    expect('completed_at' in rec.payload).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(rec.payload, 'title')).toBe(true);
    expect(rec.payload.title).toBe('T');
    expect(Object.getOwnPropertyNames(rec.payload)).toEqual(['id', 'title', 'completed_at']);
  });

  it('an assignment that FAILS is not recorded', () => {
    // A non-writable own property rejects the write in sloppy mode. Recording
    // it would claim a hook owns a value it never managed to set.
    const target: Record<string, unknown> = {};
    Object.defineProperty(target, 'locked', { value: 1, writable: false, enumerable: true });
    const rec = recordHookPayloadWrites(target);

    try { (rec.payload as any).locked = 2; } catch { /* strict mode throws; either way, no write */ }

    expect([...(rec.seal(rec.payload).hookWrittenKeys ?? [])]).toEqual([]);
    expect(target.locked).toBe(1);
  });
});
