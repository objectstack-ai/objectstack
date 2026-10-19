// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24061] The signing-key read, held across requests under both halves of the
// cross-request caching rule: (a) a write that passes the engine's middleware
// retires the held keyring in the same operation, and (b) a TTL bounds what
// that seam cannot see. The end-to-end pin — a key write through a real engine
// seen on the very next signing — is `auth-prelude-query-count.pin.test.ts`;
// this file pins the reader's own contract, one rule per case.

import { describe, it, expect } from 'vitest';
import { createSigningKeyReader, SIGNING_KEY_CACHE_TTL_MS } from './signing-key-read-cache.js';

type Middleware = (ctx: { operation?: string }, next: () => Promise<void>) => Promise<void>;

/** An engine double exposing the middleware seam, with a way to drive a write through it. */
function engineWithSeam() {
  const registered: Array<{ fn: Middleware; object?: string }> = [];
  return {
    registered,
    registerMiddleware(fn: Middleware, options?: { object?: string }) {
      registered.push({ fn, object: options?.object });
    },
    /** Run one operation through every middleware registered for `object`. */
    async run(object: string, operation: string, body: () => Promise<void> = async () => {}) {
      const chain = registered.filter((m) => !m.object || m.object === object);
      const step = async (i: number): Promise<void> => {
        if (i === chain.length) return body();
        return chain[i]!.fn({ operation }, () => step(i + 1));
      };
      await step(0);
    },
  };
}

/** A better-auth endpoint context whose adapter answers the keyring and counts the reads. */
function keyring(rows: Array<Record<string, unknown>>) {
  const state = { rows, reads: 0 };
  const ctx = {
    context: {
      adapter: {
        findMany: async ({ model }: { model: string }) => {
          expect(model).toBe('jwks');
          state.reads += 1;
          return state.rows.map((r) => ({ ...r }));
        },
      },
    },
  };
  return { state, ctx };
}

describe('[#24061] createSigningKeyReader', () => {
  it('serves a repeat read from the held keyring', async () => {
    const engine = engineWithSeam();
    const { state, ctx } = keyring([{ id: 'k1' }]);
    const read = createSigningKeyReader({ engine });

    expect(await read(ctx)).toEqual([{ id: 'k1' }]);
    expect(await read(ctx)).toEqual([{ id: 'k1' }]);
    expect(state.reads).toBe(1);
  });

  it('registers ONE observer per engine, on the keyring object only', () => {
    const engine = engineWithSeam();
    createSigningKeyReader({ engine });
    createSigningKeyReader({ engine });
    expect(engine.registered.map((m) => m.object)).toEqual(['sys_jwks']);
  });

  it('(a) a keyring write through the engine retires the held keyring — the next read sees it', async () => {
    const engine = engineWithSeam();
    const { state, ctx } = keyring([{ id: 'k1' }]);
    const read = createSigningKeyReader({ engine });
    await read(ctx);

    await engine.run('sys_jwks', 'insert', async () => {
      state.rows = [...state.rows, { id: 'k2' }];
    });

    expect((await read(ctx)).map((r) => r.id)).toEqual(['k1', 'k2']);
    expect(state.reads).toBe(2);
  });

  it('(a) a read that overlapped a write is answered but never held', async () => {
    const engine = engineWithSeam();
    const { state, ctx } = keyring([{ id: 'k1' }]);
    const read = createSigningKeyReader({ engine });
    let release!: () => void;
    const writing = engine.run('sys_jwks', 'update', () => new Promise<void>((r) => { release = r; }));

    // The write is in flight: answered from the table, not held.
    await read(ctx);
    release();
    await writing;
    await read(ctx);
    expect(state.reads).toBe(2);
    // …and once nothing is in flight, the next read is held again.
    await read(ctx);
    expect(state.reads).toBe(2);
  });

  it('a keyring READ through the engine does not retire the held keyring', async () => {
    const engine = engineWithSeam();
    const { state, ctx } = keyring([{ id: 'k1' }]);
    const read = createSigningKeyReader({ engine });
    await read(ctx);
    await engine.run('sys_jwks', 'find');
    await read(ctx);
    expect(state.reads).toBe(1);
  });

  it('(b) the TTL bounds a keyring held with no write observed', async () => {
    const engine = engineWithSeam();
    const { state, ctx } = keyring([{ id: 'k1' }]);
    let now = 1_000_000;
    const read = createSigningKeyReader({ engine, now: () => now });
    await read(ctx);

    now += SIGNING_KEY_CACHE_TTL_MS - 1;
    await read(ctx);
    expect(state.reads).toBe(1);

    now += 1;
    await read(ctx);
    expect(state.reads).toBe(2);
  });

  it('an engine with no write seam holds nothing — every read goes to the table', async () => {
    const { state, ctx } = keyring([{ id: 'k1' }]);
    const read = createSigningKeyReader({ engine: {} });
    await read(ctx);
    await read(ctx);
    expect(state.reads).toBe(2);
  });

  it('an engine whose registration throws holds nothing', async () => {
    const { state, ctx } = keyring([{ id: 'k1' }]);
    const engine = { registerMiddleware() { throw new Error('no middleware here'); } };
    const read = createSigningKeyReader({ engine });
    await read(ctx);
    await read(ctx);
    expect(state.reads).toBe(2);
  });

  it('the inner read decides the answer — a host-usable reader hides what it hides from the held keyring too', async () => {
    const engine = engineWithSeam();
    const { state, ctx } = keyring([{ id: 'k1' }, { id: 'k2' }]);
    const read = createSigningKeyReader({
      engine,
      read: async (c) => ((await c.context.adapter.findMany({ model: 'jwks' })) as any[]).filter((r) => r.id !== 'k1'),
    });
    expect((await read(ctx)).map((r) => r.id)).toEqual(['k2']);
    expect((await read(ctx)).map((r) => r.id)).toEqual(['k2']);
    expect(state.reads).toBe(1);
  });

  it('hands out copies — a caller mutating its answer does not change the next one', async () => {
    const engine = engineWithSeam();
    const { ctx } = keyring([{ id: 'k1', alg: 'EdDSA' }]);
    const read = createSigningKeyReader({ engine });
    const first = (await read(ctx)) as any[];
    first[0].alg = 'tampered';
    first.push({ id: 'k9' });
    expect(await read(ctx)).toEqual([{ id: 'k1', alg: 'EdDSA' }]);
  });
});
