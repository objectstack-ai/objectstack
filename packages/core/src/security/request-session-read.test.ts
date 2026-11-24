// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The request's session-read carrier (`request-session-read.ts`), against a
 * session API double and an engine double carrying the two seams the carrier
 * watches (the write epoch and `registerMiddleware`).
 *
 * What these pins hold:
 *
 *  1. SERVED. Inside one scope a second reader of the same request (same API,
 *     same headers) is answered by the first read: one `getSession` call, and
 *     the two readers hold distinct objects.
 *  2. ISOLATION. Outside a scope every read is fresh; other headers or another
 *     API object are another read; two interleaved scopes never share; a
 *     continuation that outlives its scope reads afresh; `joinRequestSessionRead`
 *     joins an open scope and opens its own otherwise; a handle the transport
 *     holds shares across the stretches it runs and nothing once closed;
 *     `withoutRequestSessionRead` leaves an open scope behind.
 *  3. FRESHNESS. A write that lands, a write still in flight and a non-write
 *     epoch bump between the two readers, an expired session, a read that
 *     threw, and an engine the carrier cannot watch (no engine, or no write
 *     observer yet) all make the next reader read for itself.
 */

import { describe, it, expect } from 'vitest';

import { withRequestGrantsMemo } from './request-grants-memo.js';
import {
  joinRequestSessionRead,
  openRequestSessionRead,
  readRequestSession,
  withRequestSessionRead,
  withoutRequestSessionRead,
} from './request-session-read.js';

type Middleware = (ctx: { operation: string }, next: () => Promise<void>) => Promise<void>;

/**
 * An engine double: the write epoch `readWriteEpoch` checks (all three members)
 * and `registerMiddleware`, and a write run as the engine runs one — the epoch
 * bumped first, then the middleware chain around the driver step.
 */
function makeEngine() {
  const middlewares: Middleware[] = [];
  const engine = {
    writeEpoch: {
      current: 0,
      bump(_reason: string) { this.current += 1; },
      subscribe(_listener: unknown) { return () => {}; },
    },
    registerMiddleware(fn: Middleware) { middlewares.push(fn); },
    async write(land: () => Promise<void> = async () => {}) {
      engine.writeEpoch.bump('write');
      let index = 0;
      const next = async (): Promise<void> => {
        const mw = middlewares[index++];
        if (mw) await mw({ operation: 'update' }, next);
        else await land();
      };
      await next();
    },
  };
  return engine;
}

/** An engine whose write observer is registered, as the first `resolveAuthzContext` naming it registers it. */
async function watchedEngine() {
  const engine = makeEngine();
  await withRequestGrantsMemo(engine, async () => undefined);
  return engine;
}

/** A session API double: every call is counted; `fail` makes the next calls throw. */
function makeApi(userId = 'u1', expiresAt: Date = new Date(Date.now() + 3_600_000)) {
  const api = {
    calls: 0,
    fail: 0,
    async getSession(_input: { headers: unknown }) {
      api.calls += 1;
      if (api.fail > 0) {
        api.fail -= 1;
        throw new Error('the session store is unreachable');
      }
      return { user: { id: userId }, session: { userId, token: 'tok', expiresAt } } as any;
    },
  };
  return api;
}

const bearer = (token: string) => new Headers({ authorization: `Bearer ${token}`, host: 'localhost' });

describe('request-session-read — served inside one request', () => {
  it('a second reader of the same request is answered by the first read, and holds its own object', async () => {
    const engine = await watchedEngine();
    const api = makeApi();
    await withRequestSessionRead(async () => {
      const first = await readRequestSession(api, bearer('a'), engine);
      const second = await readRequestSession(api, bearer('a'), engine);
      expect(api.calls).toBe(1);
      expect(second).toEqual(first);
      expect(second).not.toBe(first);
      (second as any).user.id = 'mutated';
      const third = await readRequestSession(api, bearer('a'), engine);
      expect((third as any).user.id).toBe('u1');
      expect(api.calls).toBe(1);
    });
  });

  it('a reader that names no engine is still answered by a stored read', async () => {
    const engine = await watchedEngine();
    const api = makeApi();
    await withRequestSessionRead(async () => {
      await readRequestSession(api, bearer('a'), engine);
      await readRequestSession(api, bearer('a'), undefined);
      expect(api.calls).toBe(1);
    });
  });
});

describe('request-session-read — isolation', () => {
  it('outside a scope every read is fresh', async () => {
    const engine = await watchedEngine();
    const api = makeApi();
    await readRequestSession(api, bearer('a'), engine);
    await readRequestSession(api, bearer('a'), engine);
    expect(api.calls).toBe(2);
  });

  it('other headers, and another session API, are another read', async () => {
    const engine = await watchedEngine();
    const api = makeApi();
    const other = makeApi('u2');
    await withRequestSessionRead(async () => {
      await readRequestSession(api, bearer('a'), engine);
      await readRequestSession(api, bearer('b'), engine);
      await readRequestSession(api, new Headers({ authorization: 'Bearer a' }), engine);
      await readRequestSession(other, bearer('a'), engine);
    });
    expect(api.calls).toBe(3);
    expect(other.calls).toBe(1);
  });

  it('two interleaved requests never share a read', async () => {
    const engine = await watchedEngine();
    const api = makeApi();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const one = withRequestSessionRead(async () => {
      await readRequestSession(api, bearer('a'), engine);
      await gate;
      await readRequestSession(api, bearer('a'), engine);
    });
    const two = withRequestSessionRead(async () => {
      await readRequestSession(api, bearer('a'), engine);
      release();
      await readRequestSession(api, bearer('a'), engine);
    });
    await Promise.all([one, two]);
    expect(api.calls).toBe(2);
  });

  it('a continuation that outlives its request reads afresh', async () => {
    const engine = await watchedEngine();
    const api = makeApi();
    let later: Promise<unknown> | undefined;
    await withRequestSessionRead(async () => {
      await readRequestSession(api, bearer('a'), engine);
      later = new Promise((resolve) => setTimeout(resolve, 5)).then(() => readRequestSession(api, bearer('a'), engine));
    });
    await later;
    expect(api.calls).toBe(2);
  });

  it('joinRequestSessionRead joins an open scope, and opens its own for its call otherwise', async () => {
    const engine = await watchedEngine();
    const api = makeApi();
    await withRequestSessionRead(async () => {
      await readRequestSession(api, bearer('a'), engine);
      await joinRequestSessionRead(() => readRequestSession(api, bearer('a'), engine));
    });
    expect(api.calls).toBe(1);
    await joinRequestSessionRead(async () => {
      await readRequestSession(api, bearer('a'), engine);
      await readRequestSession(api, bearer('a'), engine);
    });
    expect(api.calls).toBe(2);
  });

  it('a handle shares across the stretches it runs, and serves and stores nothing once closed', async () => {
    const engine = await watchedEngine();
    const api = makeApi();
    const handle = openRequestSessionRead();
    // The transport's middleware chain, then the route it hands the scope to.
    await handle.run(() => readRequestSession(api, bearer('a'), engine));
    await handle.run(() => readRequestSession(api, bearer('a'), engine));
    expect(api.calls).toBe(1);
    handle.close();
    await handle.run(async () => {
      await readRequestSession(api, bearer('a'), engine);
      await readRequestSession(api, bearer('a'), engine);
    });
    expect(api.calls).toBe(3);
  });

  it('withoutRequestSessionRead leaves the open scope behind: its reads are its own', async () => {
    const engine = await watchedEngine();
    const api = makeApi();
    await withRequestSessionRead(async () => {
      await readRequestSession(api, bearer('a'), engine);
      await withoutRequestSessionRead(async () => {
        await readRequestSession(api, bearer('a'), engine);
        // `joinRequestSessionRead` finds no scope there and opens its own.
        await joinRequestSessionRead(async () => {
          await readRequestSession(api, bearer('a'), engine);
          await readRequestSession(api, bearer('a'), engine);
        });
      });
      await readRequestSession(api, bearer('a'), engine);
    });
    expect(api.calls).toBe(3);
  });
});

describe('request-session-read — served only while a fresh read would agree', () => {
  it('a write that lands between the readers makes the next one read afresh', async () => {
    const engine = await watchedEngine();
    const api = makeApi();
    await withRequestSessionRead(async () => {
      await readRequestSession(api, bearer('a'), engine);
      await engine.write();
      await readRequestSession(api, bearer('a'), engine);
      // The fresh read is the request's read from here on.
      await readRequestSession(api, bearer('a'), engine);
    });
    expect(api.calls).toBe(2);
  });

  it('a write still in flight at the lookup makes the reader read afresh', async () => {
    const engine = await watchedEngine();
    const api = makeApi();
    let land!: () => void;
    const landed = new Promise<void>((resolve) => { land = resolve; });
    await withRequestSessionRead(async () => {
      await readRequestSession(api, bearer('a'), engine);
      const inFlight = engine.write(() => landed);
      await readRequestSession(api, bearer('a'), engine);
      land();
      await inFlight;
    });
    expect(api.calls).toBe(2);
  });

  it('a non-write epoch bump makes the reader read afresh', async () => {
    const engine = await watchedEngine();
    const api = makeApi();
    await withRequestSessionRead(async () => {
      await readRequestSession(api, bearer('a'), engine);
      engine.writeEpoch.bump('remote');
      await readRequestSession(api, bearer('a'), engine);
    });
    expect(api.calls).toBe(2);
  });

  it('an expired session is not served', async () => {
    const engine = await watchedEngine();
    const api = makeApi('u1', new Date(Date.now() - 1));
    await withRequestSessionRead(async () => {
      await readRequestSession(api, bearer('a'), engine);
      await readRequestSession(api, bearer('a'), engine);
    });
    expect(api.calls).toBe(2);
  });

  it('a read that throws reaches its reader and is not stored', async () => {
    const engine = await watchedEngine();
    const api = makeApi();
    api.fail = 1;
    await withRequestSessionRead(async () => {
      await expect(readRequestSession(api, bearer('a'), engine)).rejects.toThrow('unreachable');
      await readRequestSession(api, bearer('a'), engine);
      await readRequestSession(api, bearer('a'), engine);
    });
    expect(api.calls).toBe(2);
  });

  it('an engine the carrier cannot watch stores nothing: none named, or no write observer yet', async () => {
    const api = makeApi();
    const unwatched = makeEngine();
    await withRequestSessionRead(async () => {
      await readRequestSession(api, bearer('a'), undefined);
      await readRequestSession(api, bearer('a'), unwatched);
      await readRequestSession(api, bearer('a'), unwatched);
    });
    expect(api.calls).toBe(3);
  });
});
