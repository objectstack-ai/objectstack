// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ── Leg C of #11633 (#11966): the SUCCESS side of the localization cache ────
//
// The sibling pins in `resolve-authz-context.test.ts` cover #10221/#11877 — the
// FAILURE memo — and they still hold unchanged. This file covers the success
// cache and, above everything else, the one property the ruling made hard:
// **invalidation is synchronous and in-process**, so a read after a write
// observes the write. A TTL alone does not satisfy that, and a TTL alone is the
// exact shape that was already reverted once on this function.
//
// Two seams do the invalidating, and both are pinned here in BOTH directions —
// that it fires when it should, and that the cache actually caches when nothing
// fired (an "invalidation works" pin passes trivially on a cache that never
// caches, which is why every staleness pin below is paired with a hit pin):
//
//   1. `SettingsService.subscribe('localization', ...)` — the primary. ⚠️ There
//      is no module called a "settings change bus"; `subscribe()` IS the seam.
//   2. Writes to the tables the answer is read from (`sys_setting`,
//      `sys_platform_setting`), observed at the engine middleware seam — the
//      backstop, for writes that reach them without passing through the
//      settings service at all. [#10757 leg 5] Until then the backstop was the
//      engine write epoch, which every write to ANY object advances; the pins
//      in "a write to any OTHER object" hold it to its watched set.
//   3. The epoch's non-`write` reasons (a peer's `remote` hint, `metadata`),
//      which carry no object and retire everything.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveLocalizationContext } from './resolve-authz-context.js';

const TTL_ENV = 'OS_LOCALIZATION_CACHE_TTL_MS';

type Middleware = (ctx: { object: string; operation: string }, next: () => Promise<void>) => Promise<void>;

/**
 * The two engine seams the success cache requires, shaped as the engine's own:
 * the write epoch (bumped with `'write'` when a write STARTS, ahead of every
 * middleware — `objectql/src/engine.ts` `executeWithMiddleware`) and the
 * middleware chain every operation runs through. `write(object, apply)` is one
 * engine write: epoch first, then the chain, `apply` as its driver step.
 */
function engineSeams() {
  const listeners = new Set<(epoch: number, reason: string) => void>();
  const middlewares: Middleware[] = [];
  let epoch = 0;
  const writeEpoch = {
    get current() {
      return epoch;
    },
    bump(reason: string) {
      epoch += 1;
      for (const l of [...listeners]) l(epoch, reason);
      return epoch;
    },
    subscribe(l: (e: number, r: string) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return {
    writeEpoch,
    middlewares,
    registerMiddleware(fn: Middleware) {
      middlewares.push(fn);
    },
    async write(object: string, apply: () => void | Promise<void> = () => {}, operation = 'update') {
      // As the engine's `isWriteEpochOperation`: only a write verb advances the epoch.
      if (operation === 'insert' || operation === 'update' || operation === 'delete') writeEpoch.bump('write');
      const chain = [...middlewares];
      let i = 0;
      const next = async (): Promise<void> => {
        if (i < chain.length) return chain[i++]({ object, operation }, next);
        await apply();
      };
      await next();
    },
  };
}

/** Rows the direct `$in` fallback reads, plus a per-object query counter. */
function makeQl(rows: Array<Record<string, unknown>>, opts: { epoch?: boolean; middleware?: boolean } = {}) {
  const counts = { sys_setting: 0 };
  const seams = engineSeams();
  const ql: Record<string, unknown> = {
    counts,
    write: seams.write,
    async find(_object: string, o: any) {
      counts.sys_setting += 1;
      const where = o?.where ?? {};
      const matched = rows.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          // REFUSE a combinator rather than matching it as a field name: a
          // hand-written matcher that reads `$and` as a column silently answers
          // the wrong question instead of failing (`check:where-matcher`).
          if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
          if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(r[k]);
          return r[k] === v;
        }),
      );
      // [commit 4c9780c7a] Hold the caller's bound, AFTER the filter and by PRESENCE — a
      // double that hands back everything it matched cannot tell this read's
      // `limit: 10` from no bound at all, so folding or dropping that bound
      // would stay green here by construction.
      return typeof o?.limit === 'number' ? matched.slice(0, o.limit) : matched;
    },
  };
  // The seams are opt-in per double on purpose: the guard under test is "no seam
  // ⇒ no success cache", so a double without one is a fixture, not an oversight.
  if (opts.epoch !== false) ql.writeEpoch = seams.writeEpoch;
  if (opts.middleware !== false) ql.registerMiddleware = seams.registerMiddleware;
  return ql as typeof ql & {
    counts: typeof counts;
    writeEpoch: typeof seams.writeEpoch;
    write: typeof seams.write;
  };
}

/** A settings occupant carrying the real `subscribe(ns, handler)` seam. */
function makeSettings(values: Record<string, string | undefined>) {
  const subs = new Set<{ ns?: string; handler: (e: unknown) => void }>();
  const counts = { reads: 0 };
  return {
    counts,
    subscribe(ns: string | undefined, handler: (e: unknown) => void) {
      const entry = { ns, handler };
      subs.add(entry);
      return () => subs.delete(entry);
    },
    async get(_ns: string, key: string) {
      counts.reads += 1;
      return values[key] === undefined ? undefined : { value: values[key] };
    },
    async getMany(_ns: string, keys: string[]) {
      counts.reads += 1;
      const out: Record<string, unknown> = {};
      for (const k of keys) out[k] = values[k] === undefined ? undefined : { value: values[k] };
      return out;
    },
    /** Mirrors the real service: persist FIRST, then emit synchronously. */
    write(key: string, value: string) {
      values[key] = value;
      for (const s of [...subs]) {
        if (s.ns && s.ns !== 'localization') continue;
        s.handler({ namespace: 'localization', key, scope: 'tenant', action: 'set', at: '' });
      }
    },
  };
}

describe('resolveLocalizationContext — success cache identity (#11633 §7 pin 1)', () => {
  it('a second resolve returns a DEEP-EQUAL answer and issues ZERO reads', async () => {
    const ql = makeQl([
      { namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'Asia/Tokyo' },
      { namespace: 'localization', key: 'locale', scope: 'tenant', organization_id: 'o1', value: 'ja-JP' },
      { namespace: 'localization', key: 'currency', scope: 'tenant', organization_id: 'o1', value: 'JPY' },
    ]);
    const first = await resolveLocalizationContext({ ql, organizationId: 'o1' });
    const second = await resolveLocalizationContext({ ql, organizationId: 'o1' });
    // Both halves are load-bearing: equality alone passes on a cache that never
    // caches, and a zero-read count alone passes on a cache that returns junk.
    expect(second).toEqual(first);
    expect(first).toEqual({ timezone: 'Asia/Tokyo', locale: 'ja-JP', currency: 'JPY' });
    expect(ql.counts.sys_setting).toBe(1);
  });

  it('keys per tenant and per `ql`, so no environment or tenant reads another\'s answer', async () => {
    const rows = [{ namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'Asia/Tokyo' }];
    const qlA = makeQl(rows);
    const qlB = makeQl(rows);
    await resolveLocalizationContext({ ql: qlA, organizationId: 't1' });
    await resolveLocalizationContext({ ql: qlA, organizationId: 't2' });
    await resolveLocalizationContext({ ql: qlA, organizationId: 't1' });
    expect(qlA.counts.sys_setting).toBe(2);
    await resolveLocalizationContext({ ql: qlB, organizationId: 't1' });
    expect(qlB.counts.sys_setting).toBe(1);
  });
});

describe('resolveLocalizationContext — the settings seam invalidates synchronously', () => {
  it('a `localization` write is observed by the very next resolve, with NO clock advance', async () => {
    const ql = makeQl([]);
    const settings = makeSettings({ timezone: 'UTC' });
    const first = await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    expect(first.timezone).toBe('UTC');
    // Cached: a repeat issues no read at all.
    await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    expect(settings.counts.reads).toBe(1);

    settings.write('timezone', 'America/Los_Angeles');

    // ⭐ Assert the END of the chain — the new VALUE — never "the cache was
    // cleared". A clear-then-repopulate-from-a-stale-read implementation
    // passes the second and fails this one (#11633 §7 pin 2's discipline).
    const after = await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    expect(after.timezone).toBe('America/Los_Angeles');
    expect(settings.counts.reads).toBe(2);
  });

  it('an occupant with no `subscribe` still resolves — it just loses the precise trigger', async () => {
    const ql = makeQl([]);
    const full = makeSettings({ timezone: 'UTC' });
    const { subscribe: _drop, ...seamless } = full;
    const settings = seamless as unknown as typeof full;
    const first = await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    expect(first.timezone).toBe('UTC');
    // Still cached — the engine-side backstop and the TTL are the remaining bounds.
    await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    expect(settings.counts.reads).toBe(1);
    // ...and the backstop still retires it.
    await ql.write('sys_setting');
    await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    expect(settings.counts.reads).toBe(2);
  });

  it('never serves an answer resolved through a DIFFERENT settings occupant', async () => {
    const ql = makeQl([]);
    const a = makeSettings({ timezone: 'Asia/Tokyo' });
    const b = makeSettings({ timezone: 'Europe/Paris' });
    expect((await resolveLocalizationContext({ ql, settings: a, organizationId: 'o1' })).timezone).toBe('Asia/Tokyo');
    expect((await resolveLocalizationContext({ ql, settings: b, organizationId: 'o1' })).timezone).toBe('Europe/Paris');
  });
});

describe('resolveLocalizationContext — a write to a table the answer is read from is the backstop', () => {
  it('a DIRECT `sys_setting` write, bypassing the settings service entirely, is observed at once', async () => {
    // The case the backstop exists for: a seeder writes the row through the
    // engine, so no settings event is ever emitted.
    const rows = [{ namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'UTC' }];
    const ql = makeQl(rows);
    expect((await resolveLocalizationContext({ ql, organizationId: 'o1' })).timezone).toBe('UTC');
    await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(ql.counts.sys_setting).toBe(1);

    await ql.write('sys_setting', () => {
      rows[0].value = 'America/Los_Angeles';
    });

    expect((await resolveLocalizationContext({ ql, organizationId: 'o1' })).timezone).toBe('America/Los_Angeles');
    expect(ql.counts.sys_setting).toBe(2);
  });

  it('a `sys_platform_setting` write — the global rung `getMany` reads — retires it too', async () => {
    const ql = makeQl([]);
    const settings = makeSettings({ timezone: 'UTC' });
    await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    expect(settings.counts.reads).toBe(1);
    // A direct engine write of the global row: no settings event is emitted.
    await ql.write('sys_platform_setting', () => {}, 'insert');
    await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    expect(settings.counts.reads).toBe(2);
  });

  it('the retirement lands AFTER the write settles — a read while the write is in flight is dead on arrival', async () => {
    // The write has entered the chain (its epoch bump already happened) and its
    // driver step is still running when the resolve reads the old row.
    const rows = [{ namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'UTC' }];
    const ql = makeQl(rows);
    await resolveLocalizationContext({ ql, organizationId: 'other' }); // first sight: wires the seam
    let land!: () => void;
    const landed = new Promise<void>((r) => {
      land = r;
    });
    const inFlight = ql.write('sys_setting', async () => {
      await landed;
      rows[0].value = 'Asia/Tokyo';
    });
    expect((await resolveLocalizationContext({ ql, organizationId: 'o1' })).timezone).toBe('UTC');
    land();
    await inFlight;
    expect((await resolveLocalizationContext({ ql, organizationId: 'o1' })).timezone).toBe('Asia/Tokyo');
  });

  it('a peer node\'s hint (`remote`) retires the entry the same way a local write does', async () => {
    // With the `authz.invalidated` bridge attached, a peer's write arrives as a
    // local bump — so cross-node convergence rides the same backstop.
    const rows = [{ namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'UTC' }];
    const ql = makeQl(rows);
    await resolveLocalizationContext({ ql, organizationId: 'o1' });
    rows[0].value = 'Asia/Tokyo';
    ql.writeEpoch.bump('remote');
    expect((await resolveLocalizationContext({ ql, organizationId: 'o1' })).timezone).toBe('Asia/Tokyo');
  });

  it('a `metadata` bump — no object to judge — retires it as well', async () => {
    const rows = [{ namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'UTC' }];
    const ql = makeQl(rows);
    await resolveLocalizationContext({ ql, organizationId: 'o1' });
    rows[0].value = 'Asia/Tokyo';
    ql.writeEpoch.bump('metadata');
    expect((await resolveLocalizationContext({ ql, organizationId: 'o1' })).timezone).toBe('Asia/Tokyo');
  });
});

// [#10757 leg 5] The measured defect: every engine write retired this cache, so
// on an idle stock boot the two outbox pollers (claim UPDATEs on
// `sys_http_delivery` and `sys_notification_delivery`, about every 30 s) made a
// warm request pay the localization read again. Each pin pairs "not retired"
// with the hit it protects: the reads stay at one.
describe('resolveLocalizationContext — a write to any OTHER object does not retire it (#10757 leg 5)', () => {
  it.each(['sys_http_delivery', 'sys_notification_delivery', 'showcase_task', 'sys_session'])(
    'a `%s` write leaves the entry serving, with zero reads',
    async (object) => {
      const ql = makeQl([{ namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'UTC' }]);
      const settings = makeSettings({ timezone: 'Asia/Tokyo' });
      expect((await resolveLocalizationContext({ ql, settings, organizationId: 'o1' })).timezone).toBe('Asia/Tokyo');
      await ql.write(object);
      await ql.write(object, () => {}, 'insert');
      await ql.write(object, () => {}, 'delete');
      expect((await resolveLocalizationContext({ ql, settings, organizationId: 'o1' })).timezone).toBe('Asia/Tokyo');
      expect(settings.counts.reads).toBe(1);
      expect(ql.counts.sys_setting).toBe(0);
    },
  );

  it('a READ of a watched table retires nothing', async () => {
    const ql = makeQl([]);
    const settings = makeSettings({ timezone: 'UTC' });
    await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    await ql.write('sys_setting', () => {}, 'find');
    await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    expect(settings.counts.reads).toBe(1);
  });

  it('a bare `write` epoch bump is the middleware\'s to judge, and on its own retires nothing', async () => {
    const ql = makeQl([]);
    const settings = makeSettings({ timezone: 'UTC' });
    await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    ql.writeEpoch.bump('write');
    await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    expect(settings.counts.reads).toBe(1);
  });

  it('the observer is registered once per engine, unkeyed (so `hasObjectMiddleware` is not moved)', async () => {
    const ql = makeQl([]);
    const register = ql.registerMiddleware as (fn: unknown, opts?: unknown) => void;
    const seen: unknown[] = [];
    (ql as Record<string, unknown>).registerMiddleware = (fn: unknown, opts?: unknown) => {
      seen.push(opts);
      register(fn, opts);
    };
    await resolveLocalizationContext({ ql, organizationId: 'o1' });
    await resolveLocalizationContext({ ql, organizationId: 'o2' });
    await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(seen).toEqual([undefined]);
  });
});

describe('resolveLocalizationContext — no seam, no success cache', () => {
  it('a `ql` without a write epoch never caches a success (the pre-#11966 multiset, exactly)', async () => {
    const rows = [{ namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'UTC' }];
    const ql = makeQl(rows, { epoch: false });
    await resolveLocalizationContext({ ql, organizationId: 'o1' });
    rows[0].value = 'Asia/Tokyo';
    const second = await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(second.timezone).toBe('Asia/Tokyo');
    expect(ql.counts.sys_setting).toBe(2);
  });

  it('a `ql` with the epoch but no middleware seam never caches a success either', async () => {
    const rows = [{ namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'UTC' }];
    const ql = makeQl(rows, { middleware: false });
    await resolveLocalizationContext({ ql, organizationId: 'o1' });
    rows[0].value = 'Asia/Tokyo';
    expect((await resolveLocalizationContext({ ql, organizationId: 'o1' })).timezone).toBe('Asia/Tokyo');
    expect(ql.counts.sys_setting).toBe(2);
  });

  it('a PARTIAL epoch shape is not a seam — `{ current }` alone must not license caching', async () => {
    // A counter nothing can bump is worse than no counter: it would read as a
    // live invalidation source and pin the answer for the whole TTL.
    const rows = [{ namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'UTC' }];
    const ql = makeQl(rows, { epoch: false });
    (ql as Record<string, unknown>).writeEpoch = { current: 0 };
    await resolveLocalizationContext({ ql, organizationId: 'o1' });
    rows[0].value = 'Asia/Tokyo';
    expect((await resolveLocalizationContext({ ql, organizationId: 'o1' })).timezone).toBe('Asia/Tokyo');
    expect(ql.counts.sys_setting).toBe(2);
  });
});

describe('resolveLocalizationContext — the TTL is the residual bound (#11633 §7 pin 7)', () => {
  const saved = process.env[TTL_ENV];
  afterEach(() => {
    if (saved === undefined) delete process.env[TTL_ENV];
    else process.env[TTL_ENV] = saved;
  });

  it('`0` means OFF — a real path, and the query multiset returns to the uncached golden', async () => {
    process.env[TTL_ENV] = '0';
    const rows = [{ namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'UTC' }];
    const ql = makeQl(rows);
    const registered: unknown[] = [];
    const register = ql.registerMiddleware as (fn: unknown) => void;
    (ql as Record<string, unknown>).registerMiddleware = (fn: unknown) => {
      registered.push(fn);
      register(fn);
    };
    await resolveLocalizationContext({ ql, organizationId: 'o1' });
    rows[0].value = 'Asia/Tokyo';
    const second = await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(second.timezone).toBe('Asia/Tokyo');
    expect(ql.counts.sys_setting).toBe(2);
    // OFF leaves no footprint on the engine: nothing is registered.
    expect(registered).toHaveLength(0);
  });

  it('a MALFORMED value reads as off, never as the default — it must not widen the window', async () => {
    // `3OOO` with letter O. Folding it into the 30s default would hand the
    // operator a LONGER window than the one they were trying to set.
    process.env[TTL_ENV] = '3OOO';
    const rows = [{ namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'UTC' }];
    const ql = makeQl(rows);
    await resolveLocalizationContext({ ql, organizationId: 'o1' });
    rows[0].value = 'Asia/Tokyo';
    expect((await resolveLocalizationContext({ ql, organizationId: 'o1' })).timezone).toBe('Asia/Tokyo');
    expect(ql.counts.sys_setting).toBe(2);
  });

  it('an entry expires on the configured bound even when no write ever happens', async () => {
    vi.useFakeTimers();
    try {
      const ql = makeQl([{ namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'UTC' }]);
      await resolveLocalizationContext({ ql, organizationId: 'o1' });
      await resolveLocalizationContext({ ql, organizationId: 'o1' });
      expect(ql.counts.sys_setting).toBe(1);
      await vi.advanceTimersByTimeAsync(30_001);
      await resolveLocalizationContext({ ql, organizationId: 'o1' });
      expect(ql.counts.sys_setting).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── The card's own hard constraint: the two memos MUST NOT FIGHT ────────────
//
// #10221's memo exists for an environment where `sys_setting` does not exist,
// so the read throws on every request and the driver logs a line every time.
// Invalidation must not touch it: a write to ANY object retiring that memo
// would restart exactly the log spam #10221 removed — and no write can create a
// missing table, so there is nothing there for a write to correct.
describe('resolveLocalizationContext — the failure memo survives what retires a success', () => {
  function makeFailingQl() {
    const counts = { sys_setting: 0 };
    const seams = engineSeams();
    return {
      counts,
      writeEpoch: seams.writeEpoch,
      registerMiddleware: seams.registerMiddleware,
      write: seams.write,
      async find() {
        counts.sys_setting += 1;
        throw new Error('no such table: sys_setting');
      },
    };
  }

  it('an engine write does NOT retire a failure entry (#10221 log spam stays fixed)', async () => {
    const ql = makeFailingQl();
    const settings = makeSettings({});
    expect(await resolveLocalizationContext({ ql, settings, organizationId: 'o1' })).toEqual({
      timezone: 'UTC',
      locale: 'en-US',
      currency: undefined,
    });
    expect(ql.counts.sys_setting).toBe(1);

    await ql.write('sys_setting');
    ql.writeEpoch.bump('remote');
    settings.write('timezone', 'Asia/Tokyo');

    await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    // Still ONE failing query: the memo is TTL-bound only, exactly as shipped.
    expect(ql.counts.sys_setting).toBe(1);
  });

  it('the failure memo still self-heals on its own TTL once the migration lands', async () => {
    vi.useFakeTimers();
    try {
      const ql = makeFailingQl();
      await resolveLocalizationContext({ ql, organizationId: 'o1' });
      expect(ql.counts.sys_setting).toBe(1);
      await vi.advanceTimersByTimeAsync(30_001);
      await resolveLocalizationContext({ ql, organizationId: 'o1' });
      expect(ql.counts.sys_setting).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a success recorded AFTER a failure replaces it, and is itself invalidatable', async () => {
    // The two kinds share one key, so the later outcome must win cleanly in
    // both directions — a stuck failure entry would pin the fallback forever.
    const rows: Array<Record<string, unknown>> = [];
    let broken = true;
    const counts = { sys_setting: 0 };
    const seams = engineSeams();
    const ql = {
      counts,
      writeEpoch: seams.writeEpoch,
      registerMiddleware: seams.registerMiddleware,
      async find() {
        counts.sys_setting += 1;
        if (broken) throw new Error('no such table: sys_setting');
        return rows;
      },
    };
    await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(counts.sys_setting).toBe(1);

    // Migration lands; the memo is still standing, so nothing changes yet.
    broken = false;
    rows.push({ namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'Asia/Tokyo' });
    await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(counts.sys_setting).toBe(1);

    // The memo expires, a SUCCESS is recorded in its place...
    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(30_001);
      expect((await resolveLocalizationContext({ ql, organizationId: 'o1' })).timezone).toBe('Asia/Tokyo');
      expect(counts.sys_setting).toBe(2);
      await resolveLocalizationContext({ ql, organizationId: 'o1' });
      expect(counts.sys_setting).toBe(2);
    } finally {
      vi.useRealTimers();
    }

    // ...and that success is retired by a write, like any other.
    await seams.write('sys_setting', () => {
      rows[0].value = 'Europe/Paris';
    });
    expect((await resolveLocalizationContext({ ql, organizationId: 'o1' })).timezone).toBe('Europe/Paris');
  });
});

describe('resolveLocalizationContext — a write DURING the read must not be swallowed', () => {
  it('an entry is stamped with the PRE-read generation, so a write landing mid-read kills it on arrival', async () => {
    // The clear-then-repopulate-from-a-stale-read failure, at its sharpest: the
    // write lands after the query was issued and before the answer is stored.
    // Stamping the entry with the post-read epoch would make that staleness
    // permanent, invisible, and unbounded by any further event.
    const rows = [{ namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'UTC' }];
    const counts = { sys_setting: 0 };
    const seams = engineSeams();
    let raceOnce = true;
    const ql = {
      counts,
      writeEpoch: seams.writeEpoch,
      registerMiddleware: seams.registerMiddleware,
      async find() {
        counts.sys_setting += 1;
        const snapshot = rows.map((r) => ({ ...r }));
        if (raceOnce) {
          raceOnce = false;
          // The concurrent write, mid-flight: the row changes and the seam
          // advances AFTER this read's result was already determined.
          await seams.write('sys_setting', () => {
            rows[0].value = 'Asia/Tokyo';
          });
        }
        return snapshot;
      },
    };
    const first = await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(first.timezone).toBe('UTC');
    // The stale answer must NOT be reusable — the next call re-reads.
    const second = await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(second.timezone).toBe('Asia/Tokyo');
    expect(counts.sys_setting).toBe(2);
  });
});
