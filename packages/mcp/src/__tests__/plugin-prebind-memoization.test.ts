// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ── #11622 — a data call that RACES the boot must not freeze the transport ──
//
// ## The residual this file pins
//
// #11580 moved the stdio transport's localization read out of
// `MCPServerPlugin.start()` and onto a `kernel:bootstrapped` hook, memoized so
// it stays one resolution for the life of the transport (#7279). The memo has
// a second, lazy entry point — `resolvePrincipal()` awaits the same memo — and
// that entry is deliberate: it is why a host that never fires the boot hooks
// resolves at first use instead of deadlocking on a hook that never arrives.
//
// It was also the residual. The transport goes live inside
// `MCPServerPlugin.start()`, at `runtime.start()`:
//
//     MCPServerPlugin.start()   ← the transport claims stdin/stdout HERE
//       … the remaining plugins' start() bodies …
//     kernel:ready handlers     ← SettingsServicePlugin binds its engine HERE
//     kernel:bootstrapped       ← the localization read HERE
//
// A client fast enough to send a data call in that stretch reached
// `resolvePrincipal()` first. With a memo armed by the FIRST READ, that call
// resolved localization pre-bind, got `UTC` / `en-US` from the manifest
// defaults — and KEPT it. The narrow race became the permanent wrong value
// #11580 was about, for the life of the process.
//
// ## What "pinned" has to mean here, and why the first answer is not it
//
// The defect is a PERSISTENCE defect. A wrong value that self-corrects on the
// second call is a different, much smaller bug than the one filed, so a pin
// that only checked the racing call's own answer would pass on both. Every
// case below therefore reads AGAIN after the boot has completed and asserts
// the CONFIGURED value there — `zh-CN` / `Asia/Shanghai` / `CNY`, which in this
// fixture exist only behind the settings bind (`sys_setting` answers empty on
// purpose, so the bound settings service is the single possible source).
//
// The racing call's own answer is recorded rather than corrected: inside the
// window there is nothing better to answer with, and the only closure that
// would have answered it correctly (AWAIT the bind) hangs every host that
// never fires the hook — see `a host that never fires kernel:bootstrapped`
// below, which is the case that rules that option out.
//
// ## What was built, and the pin that chose it
//
// The memo is scoped to the settings BIND EPOCH: a resolution taken while the
// window is open is kept only until the window closes, and the first one taken
// after the close lives for the life of the transport. The card's literal
// option 2 — do not memoize at all before the bind — was built first and the
// tree refused it: `plugin-execution-context.test.ts`'s #7279 pin drives a
// context whose `hook()` never fires, so that host's window never closes and
// every read resolved (`expected "vi.fn()" to be called 1 times, but got 3
// times`). The epoch keeps that property on hookless hosts and still cannot
// let a pre-bind answer outlive the boot. Its price is pinned below too, in
// `a mid-window read AFTER a racer`.
//
// ## How the window is DRIVEN, not reconstructed
//
// The read is issued from inside the stubbed `MCPServerRuntime.start()` — i.e.
// at the exact instant the transport claims stdin/stdout, the earliest moment
// a client can reach this surface, and strictly before any `kernel:ready`
// handler. Nothing about the window is hand-assembled: the real `LiteKernel`
// runs the real phase sequence, and `settings.readsAtBind` (the read count at
// the moment the engine bound) is asserted to be 1, which is the measurement
// that the racing read really landed pre-bind rather than merely being
// declared to have.
//
// The settings DOUBLE is the same one `plugin-settings-bind-window.test.ts`
// uses and for the same reason: `@objectstack/mcp` does not depend on
// `@objectstack/service-settings` and must not grow that edge for a test. It
// reproduces the two facts this turns on — registered in `init()`, engine
// bound from a `kernel:ready` hook registered in `start()` — and nothing else.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { MCPServerPlugin } from '../plugin.js';
import { MCPServerRuntime } from '../mcp-server-runtime.js';

/** What the workspace has PERSISTED — readable only once the engine is bound. */
const CONFIGURED: Record<string, string> = {
  timezone: 'Asia/Shanghai',
  locale: 'zh-CN',
  currency: 'CNY',
};

/** What the settings service answers INSIDE the bind window: manifest defaults. */
const MANIFEST_DEFAULTS: Record<string, string> = { timezone: 'UTC', locale: 'en-US' };

type ReadPhase = 'pre-bind' | 'bound';

interface SettingsDouble {
  service: Record<string, unknown>;
  reads: Array<{ namespace: string; keys: string[]; phase: ReadPhase }>;
  /** Reads already taken at the moment the engine bound — the pre-bind count. */
  readsAtBind: number | undefined;
  bind(): void;
}

function createSettingsDouble(): SettingsDouble {
  let bound = false;
  const double: SettingsDouble = {
    reads: [],
    readsAtBind: undefined,
    bind() {
      double.readsAtBind = double.reads.length;
      bound = true;
    },
    service: {},
  };
  const answer = (keys: string[]) => {
    const source = bound ? CONFIGURED : MANIFEST_DEFAULTS;
    const out: Record<string, { value: string; source: string } | undefined> = {};
    for (const key of keys) {
      const value = source[key];
      out[key] = value === undefined ? undefined : { value, source: bound ? 'tenant' : 'default' };
    }
    return out;
  };
  double.service = {
    get: vi.fn(async (namespace: string, key: string) => {
      double.reads.push({ namespace, keys: [key], phase: bound ? 'bound' : 'pre-bind' });
      return answer([key])[key];
    }),
    getMany: vi.fn(async (namespace: string, keys: string[]) => {
      double.reads.push({ namespace, keys, phase: bound ? 'bound' : 'pre-bind' });
      return answer(keys);
    }),
  };
  return double;
}

/** `SettingsServicePlugin`'s lifecycle shape, and only that. */
function settingsProviderPlugin(double: SettingsDouble): Plugin {
  return {
    name: 'com.objectstack.service.settings',
    providesServices: ['settings'],
    async init(ctx: PluginContext) {
      ctx.registerService('settings', double.service);
    },
    async start(ctx: PluginContext) {
      ctx.hook('kernel:ready', async () => {
        double.bind();
      });
    },
  };
}

interface FindCall {
  object: string;
  recordId: unknown;
  options: { context?: ExecutionContext; where?: { id?: unknown } };
}

function fakeObjectQL(finds: FindCall[]) {
  return {
    find: vi.fn(async (object: string, options: FindCall['options']) => {
      finds.push({ object, recordId: options?.where?.id, options });
      if (object === 'sys_api_key') return [{ id: 'k1', user_id: 'usr_stdio', revoked: false }];
      if (object === 'sys_setting') return [];
      return [{ id: 'r_1', name: 'Acme' }];
    }),
    findOne: vi.fn(async () => null),
    count: vi.fn(async () => 0),
  };
}

function fakeMetadata() {
  return {
    listObjects: vi.fn(async () => []),
    getObject: vi.fn(async () => null),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    exists: vi.fn(async () => false),
    getRegisteredTypes: vi.fn(async () => ['object']),
    register: vi.fn(),
    unregister: vi.fn(),
  };
}

function servicePlugin(name: string, serviceName: string, service: unknown): Plugin {
  return {
    name,
    providesServices: [serviceName],
    async init(ctx: PluginContext) {
      ctx.registerService(serviceName, service);
    },
    async start() {},
  };
}

type RecordReader = (object: string, id: string) => Promise<unknown>;

interface Rig {
  /** Every row read the engine saw, in order, tagged by the record id asked for. */
  finds: FindCall[];
  settings: SettingsDouble;
  /** The principal-bound reader the plugin built — usable after `boot()`. */
  read: RecordReader;
  /** Plugin `start()` order as the KERNEL actually ran it. */
  startOrder: string[];
}

/** The `ExecutionContext` the read of `recordId` carried into the engine. */
function contextOf(finds: FindCall[], recordId: string): ExecutionContext {
  const call = finds.filter((f) => f.object === 'crm_account' && f.recordId === recordId).pop();
  if (!call?.options.context) throw new Error(`no engine read for '${recordId}' carried an ExecutionContext`);
  return call.options.context;
}

/**
 * Boot the real plugin set through the real kernel.
 *
 * `atTransportAttach` runs from inside the stubbed `MCPServerRuntime.start()`:
 * the transport has just gone live, no `kernel:ready` handler has run, and the
 * settings engine is therefore unbound. That is the window, driven rather than
 * described.
 *
 * `atKernelReadyAfterBind` runs from a `kernel:ready` handler registered by a
 * probe plugin that starts AFTER the settings provider — handlers run in
 * registration order, so this one lands after the bind but still before
 * `kernel:bootstrapped`: the same window, its far half.
 */
async function boot(opts: {
  atTransportAttach?: (read: RecordReader, finds: FindCall[]) => Promise<void>;
  atKernelReadyAfterBind?: (read: RecordReader, finds: FindCall[]) => Promise<void>;
} = {}): Promise<Rig> {
  const finds: FindCall[] = [];
  const settings = createSettingsDouble();
  const startOrder: string[] = [];
  let getRecord: RecordReader | undefined;
  const requireReader = (): RecordReader => {
    if (!getRecord) throw new Error('the stdio path registered no record reader before this point');
    return getRecord;
  };

  const probe: Plugin = {
    name: 'com.objectstack.test.probe',
    dependencies: [],
    async init() {},
    async start(ctx: PluginContext) {
      ctx.hook('kernel:ready', async () => {
        if (opts.atKernelReadyAfterBind) await opts.atKernelReadyAfterBind(requireReader(), finds);
      });
    },
  };

  const plugins: Plugin[] = [
    settingsProviderPlugin(settings),
    servicePlugin('com.objectstack.engine.objectql', 'objectql', fakeObjectQL(finds)),
    servicePlugin('com.objectstack.service.metadata', 'metadata', fakeMetadata()),
    new MCPServerPlugin({ autoStart: true }),
    probe,
  ];
  for (const plugin of plugins) {
    const inner = plugin.start!.bind(plugin);
    plugin.start = async (ctx: PluginContext) => {
      startOrder.push(plugin.name);
      await inner(ctx);
    };
  }

  const bridgeResources = vi
    .spyOn(MCPServerRuntime.prototype, 'bridgeResources')
    .mockImplementation((_meta: unknown, reader?: unknown) => {
      getRecord = reader as RecordReader;
    });
  const bridgePrompts = vi
    .spyOn(MCPServerRuntime.prototype, 'bridgePrompts')
    .mockImplementation(async () => {});
  // The transport attach. Stubbed because the real one claims this test
  // process's stdin/stdout — and it is also the one seam where "a client can
  // now reach us" is expressible, which is why the racing read is issued here.
  const transportStart = vi
    .spyOn(MCPServerRuntime.prototype, 'start')
    .mockImplementation(async () => {
      if (opts.atTransportAttach) await opts.atTransportAttach(requireReader(), finds);
    });

  try {
    const kernel = new LiteKernel({ logger: { level: 'silent' } });
    for (const plugin of plugins) kernel.use(plugin);
    await kernel.bootstrap();
  } finally {
    bridgeResources.mockRestore();
    bridgePrompts.mockRestore();
    transportStart.mockRestore();
  }

  return { finds, settings, read: requireReader(), startOrder };
}

describe('#11622 — a data call inside the bind window must not freeze the transport', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OS_MCP_SERVER_TRANSPORT;
    delete process.env.OS_MCP_STDIO_ENABLED;
    process.env.OS_MCP_STDIO_API_KEY = 'osk_prebind_memoization_pin';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ── The window is real, and this is the measurement that says so ──────────
  // Without this case a green below could mean "no call ever landed pre-bind".
  it('the racing read really lands pre-bind (readsAtBind === 1), and gets the defaults', async () => {
    const { finds, settings, startOrder } = await boot({
      atTransportAttach: async (read) => {
        await read('crm_account', 'r_racer');
      },
    });

    // The engine bound with exactly one settings read already taken — the
    // racing one. The defect's signature and this fix's precondition are the
    // same number; what differs is what happens to its ANSWER.
    expect(settings.readsAtBind).toBe(1);
    expect(settings.reads[0]!.phase).toBe('pre-bind');
    expect(settings.reads[0]!.namespace).toBe('localization');

    // The racing call's own answer, recorded rather than claimed correct:
    // inside the window there is nothing better to answer with.
    const racing = contextOf(finds, 'r_racer');
    expect(racing.locale).toBe('en-US');
    expect(racing.timezone).toBe('UTC');

    // And the transport attach really did run before every kernel:ready
    // handler — the phase claim above, measured rather than assumed.
    expect(startOrder).toContain('com.objectstack.mcp');
  });

  // ── The card's payload: the pre-bind answer is NOT kept ───────────────────
  it('does not memoize the racing pre-bind answer — the next call carries the CONFIGURED locale', async () => {
    const { finds, settings, read } = await boot({
      atTransportAttach: async (r) => {
        await r('crm_account', 'r_racer');
      },
    });

    expect(settings.readsAtBind).toBe(1);

    await read('crm_account', 'r_after_boot');
    const after = contextOf(finds, 'r_after_boot');
    expect(after.locale).toBe('zh-CN');
    expect(after.timezone).toBe('Asia/Shanghai');
    expect(after.currency).toBe('CNY');
  });

  // ── "for the life of the transport" — the persistence half, stated ────────
  // A wrong value that self-corrects on call 2 is a smaller bug than the one
  // filed. This asserts the value on calls 1..8 after the boot, so a fix that
  // merely flushed one stale answer would not pass either.
  it('every later call carries the configured locale, not just the first one after the boot', async () => {
    const { finds, read } = await boot({
      atTransportAttach: async (r) => {
        await r('crm_account', 'r_racer');
      },
    });

    for (let i = 0; i < 8; i++) await read('crm_account', `r_late_${i}`);

    for (let i = 0; i < 8; i++) {
      const ctx = contextOf(finds, `r_late_${i}`);
      expect(ctx.locale).toBe('zh-CN');
      expect(ctx.timezone).toBe('Asia/Shanghai');
    }
  });

  // ── #7279 survives the repair, and the count says which repair this is ────
  // Exactly two resolutions ever: the racing one (discarded) and the one the
  // `kernel:bootstrapped` hook takes when the window closes. A fix that simply
  // deleted the memo would read 1 + 8 here; the defect reads 1.
  it('still resolves ONCE after the window closes — the racing read costs one extra resolution, not one per call', async () => {
    const { settings, read } = await boot({
      atTransportAttach: async (r) => {
        await r('crm_account', 'r_racer');
      },
    });

    const afterBoot = settings.reads.length;
    for (let i = 0; i < 8; i++) await read('crm_account', `r_steady_${i}`);

    // Two, ever: the racer's (discarded when the window closed) and the one
    // the `kernel:bootstrapped` hook took on closing it.
    expect(afterBoot).toBe(2);
    expect(settings.reads.map((r) => r.phase)).toEqual(['pre-bind', 'bound']);
    // The eight steady-state calls added nothing.
    expect(settings.reads).toHaveLength(2);
  });

  // ── The far half of the window: bound, but not yet bootstrapped ───────────
  //
  // `kernel:ready` handlers registered after the settings provider's run after
  // the bind — seconds of schema sync and backfills on a real deployment. Both
  // halves of what the epoch memo does there are pinned, including the half
  // that is a cost.
  it('a mid-window read with no earlier racer resolves fresh and already sees the configured locale', async () => {
    let seen: ExecutionContext | undefined;
    const { settings, startOrder } = await boot({
      atKernelReadyAfterBind: async (read, finds) => {
        await read('crm_account', 'r_mid_window');
        seen = contextOf(finds, 'r_mid_window');
      },
    });

    // The probe's handler really ran after the settings bind — the arrangement
    // this case depends on, measured rather than assumed.
    expect(startOrder.indexOf('com.objectstack.test.probe')).toBeGreaterThan(
      startOrder.indexOf('com.objectstack.service.settings'),
    );
    expect(settings.readsAtBind).toBe(0);

    expect(seen?.locale).toBe('zh-CN');
    expect(seen?.timezone).toBe('Asia/Shanghai');
  });

  it('a mid-window read AFTER a racer is served the racer’s pre-bind answer — the epoch memo’s declared cost', async () => {
    let seen: ExecutionContext | undefined;
    const { finds, settings, read } = await boot({
      atTransportAttach: async (r) => {
        await r('crm_account', 'r_racer');
      },
      atKernelReadyAfterBind: async (r, f) => {
        await r('crm_account', 'r_mid_window');
        seen = contextOf(f, 'r_mid_window');
      },
    });

    // Recorded, not corrected. While the window is open all callers share one
    // answer; buying a fresh read here costs #7279's property on every host
    // that never closes the window (see the hookless case below).
    expect(settings.readsAtBind).toBe(1);
    expect(seen?.locale).toBe('en-US');

    // What matters is that it cannot outlive the window. This is the whole of
    // the card, and it is the assertion that separates this cost from the
    // defect: the very next call after the boot carries the configured value.
    await read('crm_account', 'r_after_boot');
    expect(contextOf(finds, 'r_after_boot').locale).toBe('zh-CN');
    expect(contextOf(finds, 'r_after_boot').timezone).toBe('Asia/Shanghai');
  });

  // ── No racer ⇒ nothing changes from #11580 ────────────────────────────────
  it('with no call racing the boot, the transport still takes exactly one post-bind read', async () => {
    const { finds, settings, read } = await boot();

    expect(settings.readsAtBind).toBe(0);
    for (let i = 0; i < 5; i++) await read('crm_account', `r_plain_${i}`);

    expect(settings.reads).toHaveLength(1);
    expect(settings.reads[0]!.phase).toBe('bound');
    expect(contextOf(finds, 'r_plain_4').locale).toBe('zh-CN');
  });
});

// ── The host that rules out "await the bind" ────────────────────────────────
//
// The obvious closure for this card is to make the racing call WAIT for the
// bind. This is the host it breaks: a bare context whose `hook()` records
// handlers and never fires them — the shape `plugin.test.ts` has always used,
// and the shape of a lean kernel or a test harness that never completes a
// boot. `kernel:bootstrapped` never arrives, so an awaited deferred never
// settles and the MCP call never returns.
describe('#11622 — a host that never fires kernel:bootstrapped still answers', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OS_MCP_SERVER_TRANSPORT;
    delete process.env.OS_MCP_STDIO_ENABLED;
    process.env.OS_MCP_STDIO_API_KEY = 'osk_prebind_hookless_host';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('answers instead of hanging, and pays a resolution per read for never learning the bind happened', async () => {
    const finds: FindCall[] = [];
    const settings = createSettingsDouble();
    const services: Record<string, unknown> = {
      objectql: fakeObjectQL(finds),
      metadata: fakeMetadata(),
      settings: settings.service,
    };
    const registered = new Map<string, unknown>(Object.entries(services));
    const hooks: string[] = [];
    const ctx = {
      registerService: vi.fn((name: string, service: unknown) => registered.set(name, service)),
      getService: vi.fn((name: string) => {
        if (!registered.has(name)) throw new Error(`Service "${name}" not found`);
        return registered.get(name);
      }),
      replaceService: vi.fn(),
      getServices: vi.fn(() => registered),
      // The whole point: handlers are recorded and NEVER fired.
      hook: vi.fn((name: string) => { hooks.push(name); }),
      trigger: vi.fn(async () => {}),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(() => ({})),
    } as unknown as PluginContext;

    let getRecord: RecordReader | undefined;
    vi.spyOn(MCPServerRuntime.prototype, 'bridgeResources').mockImplementation(
      (_meta: unknown, reader?: unknown) => {
        getRecord = reader as RecordReader;
      },
    );
    vi.spyOn(MCPServerRuntime.prototype, 'bridgePrompts').mockImplementation(async () => {});
    vi.spyOn(MCPServerRuntime.prototype, 'start').mockImplementation(async () => {});

    const plugin = new MCPServerPlugin({ autoStart: true });
    await plugin.init(ctx);
    await plugin.start(ctx);

    expect(hooks).toContain('kernel:bootstrapped');
    if (!getRecord) throw new Error('the stdio path registered no record reader');
    const read = getRecord;

    // A hang here is the failure this case exists to catch, so it is named
    // rather than left to the suite timeout.
    const withDeadline = async (label: string, work: Promise<unknown>) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          work,
          new Promise((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error(`${label} never settled — the read is waiting on a hook this host never fires`)),
              2_000,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    await withDeadline('first read', read('crm_account', 'r_hookless_1'));
    await withDeadline('second read', read('crm_account', 'r_hookless_2'));

    // It answered. With what, is the honest part: this host never binds an
    // engine either, so the double stays pre-bind and the defaults are the
    // only truth available.
    expect(contextOf(finds, 'r_hookless_2').locale).toBe('en-US');

    // And it answered ONCE. This is the constraint that chose the epoch memo
    // over the card's literal option 2: with no bind ever coming, the window
    // never closes, so a memo armed only by the close would resolve on every
    // read and break #7279 on exactly the hosts the lazy entry exists for
    // (`plugin-execution-context.test.ts` pins that property directly, and it
    // is the pin that went red when option 2 was built as written).
    expect(settings.reads).toHaveLength(1);
    expect(settings.reads[0]!.phase).toBe('pre-bind');
  });
});
