// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ── #11580 — the stdio transport's localization is READ AFTER THE BIND ──────
//
// ## The defect this file pins
//
// `MCPServerPlugin.start()` used to resolve the workspace's localization
// in-line, on the stdio auto-start path:
//
//     settingsService = ctx.getService('settings');
//     const localization = await resolveLocalizationContext({ settings, … });
//
// `SettingsServicePlugin` REGISTERS its service in `init()` but binds its DATA
// ENGINE from a `kernel:ready` hook it registers in its own `start()`. Every
// plugin's `start()` body runs strictly before the first `kernel:ready`
// handler, so that read was inside the bind window under EVERY composition
// order — ordering this plugin after the settings plugin does not help, and the
// `optionalDependencies` edge that repairs the #10250 class would not move it
// (that is exactly why `check:settings-bind-window` ledgered this site as
// `unfixable-by-declaration` rather than `undeclared`).
//
// In the window the read does not FAIL — it succeeds with the wrong answer:
// the empty in-memory fallback plus the manifest defaults answer with
// `source: 'default'`, so `resolveLocalizationContext` returns `UTC` / `en-US`,
// reports no failure, and never reaches its direct `sys_setting` fallback.
// #7279 then holds that value for the life of the transport by design, so a
// long-lived stdio MCP server served every call with the manifest defaults on a
// workspace whose persisted `localization` rows said otherwise, forever.
//
// ## What is asserted, and why it is the CONFIGURED value
//
// A test that only asserted "a settings read happened" would stay green on the
// defect — the defect IS a read, at the wrong time, with a plausible answer. So
// every case below asserts the value that reaches the data engine: the
// `ExecutionContext` carried by `ql.find` must hold the CONFIGURED locale
// (`zh-CN` / `Asia/Shanghai` / `CNY`), which in this fixture exists ONLY behind
// the bind. `sys_setting` answers empty here on purpose, so the settings
// service after its bind is the single possible source of those values.
//
// ## Why the sweep, rather than one arrangement
//
// The card's claim is an ORDERING claim ("under every composition order"), and
// a pin that booted one arrangement would leave exactly that claim unpinned.
// So the sweep boots all 24 permutations of the four plugins through the REAL
// `LiteKernel` — real `resolvePluginOrder`, real phase sequencing, real hook
// dispatch — and each case additionally asserts the arrangement it MEASURED
// (`startOrder`), so a kernel that silently normalized the order into one shape
// would fail here instead of quietly collapsing 24 cases into one.
//
// ## Why a settings DOUBLE and not `SettingsServicePlugin`
//
// `@objectstack/mcp` does not depend on `@objectstack/service-settings` and
// must not grow that edge for a test. The double reproduces the two facts this
// card turns on, and nothing else: the service is registered in `init()`, and
// its engine binds from a `kernel:ready` hook registered in `start()`. The
// direction of any drift is safe: if the real plugin ever bound EARLIER, this
// double would merely be a stricter window than production has, so the pin
// would still be sound. `check:settings-bind-window` is the gate that watches
// the real provider's shape.

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

/**
 * What the settings service answers INSIDE the bind window: the manifest
 * defaults, `source: 'default'`, non-empty — which is why the defect is silent
 * (`resolveLocalizationContext` takes this branch and returns successfully).
 */
const MANIFEST_DEFAULTS: Record<string, string> = { timezone: 'UTC', locale: 'en-US' };

type ReadPhase = 'pre-bind' | 'bound';

interface SettingsDouble {
  service: Record<string, unknown>;
  /** Every namespace read, tagged with the phase it landed in. */
  reads: Array<{ namespace: string; keys: string[]; phase: ReadPhase }>;
  /** Reads already taken at the moment the engine bound (the pre-bind count). */
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

/**
 * `SettingsServicePlugin`'s lifecycle shape, and only that: register in
 * `init()`, bind the engine from a `kernel:ready` hook registered in `start()`.
 */
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
  options: { context?: ExecutionContext };
}

/**
 * The `objectql` service, faked at the one seam this path uses. `sys_api_key`
 * feeds the REAL `resolveAuthzContext` chain (same fixture as
 * `plugin.record-resource-exposure.test.ts`); `sys_setting` answers EMPTY so
 * the configured locale can only come from the bound settings service.
 */
function fakeObjectQL(finds: FindCall[]) {
  return {
    find: vi.fn(async (object: string, options: FindCall['options']) => {
      finds.push({ object, options });
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

interface BootResult {
  /** The `ExecutionContext` the last row read carried into the engine. */
  context: ExecutionContext;
  settings: SettingsDouble;
  /** Plugin `start()` order as the KERNEL actually ran it. */
  startOrder: string[];
}

/**
 * Boot the real plugin set through the real kernel in `order`, then drive
 * `reads` record reads through the principal-bound reader the plugin built.
 *
 * Only three `MCPServerRuntime` seams are stubbed, all for the same reason —
 * `start()` would claim this test process's real stdin/stdout, and the prompt /
 * resource bridges have nothing to say here. Everything this card is about
 * (when the settings handle is taken, what it answers, what reaches the engine)
 * runs for real.
 */
async function bootAndRead(orderKeys: readonly PluginKey[], reads = 1): Promise<BootResult> {
  const finds: FindCall[] = [];
  const settings = createSettingsDouble();
  const startOrder: string[] = [];

  const plugins: Record<PluginKey, Plugin> = {
    settings: settingsProviderPlugin(settings),
    objectql: servicePlugin('com.objectstack.engine.objectql', 'objectql', fakeObjectQL(finds)),
    metadata: servicePlugin('com.objectstack.service.metadata', 'metadata', fakeMetadata()),
    mcp: new MCPServerPlugin({ autoStart: true }),
  };
  for (const key of ['settings', 'objectql', 'metadata'] as const) {
    const plugin = plugins[key];
    const inner = plugin.start!.bind(plugin);
    plugin.start = async (ctx: PluginContext) => {
      startOrder.push(plugin.name);
      await inner(ctx);
    };
  }

  let getRecord: ((object: string, id: string) => Promise<unknown>) | undefined;
  const bridgeResources = vi
    .spyOn(MCPServerRuntime.prototype, 'bridgeResources')
    .mockImplementation((_meta: unknown, reader?: unknown) => {
      // Also the observation point for MCP's own position in the start order:
      // this runs inside `MCPServerPlugin.start()`.
      startOrder.push('com.objectstack.mcp');
      getRecord = reader as typeof getRecord;
    });
  const bridgePrompts = vi
    .spyOn(MCPServerRuntime.prototype, 'bridgePrompts')
    .mockImplementation(async () => {});
  const transportStart = vi
    .spyOn(MCPServerRuntime.prototype, 'start')
    .mockImplementation(async () => {});

  try {
    const kernel = new LiteKernel({ logger: { level: 'silent' } });
    for (const key of orderKeys) kernel.use(plugins[key]);
    await kernel.bootstrap();
  } finally {
    bridgeResources.mockRestore();
    bridgePrompts.mockRestore();
    transportStart.mockRestore();
  }

  if (!getRecord) throw new Error('stdio start registered no record reader');
  for (let i = 0; i < reads; i++) await getRecord('crm_account', `r_${i}`);

  const rowRead = finds.filter((f) => f.object === 'crm_account').pop();
  if (!rowRead?.options.context) throw new Error('no row read carried an ExecutionContext');
  return { context: rowRead.options.context, settings, startOrder };
}

type PluginKey = 'settings' | 'objectql' | 'metadata' | 'mcp';

const PLUGIN_KEYS: readonly PluginKey[] = ['settings', 'objectql', 'metadata', 'mcp'];

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i]!, ...tail]);
  }
  return out;
}

const ORDERS = permutations(PLUGIN_KEYS);

/** Plugin name → the sweep key that composed it. */
const KEY_OF: Record<string, PluginKey> = {
  'com.objectstack.service.settings': 'settings',
  'com.objectstack.engine.objectql': 'objectql',
  'com.objectstack.service.metadata': 'metadata',
  'com.objectstack.mcp': 'mcp',
};

describe('#11580 — the stdio transport reads localization after the settings bind', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OS_MCP_SERVER_TRANSPORT;
    delete process.env.OS_MCP_STDIO_ENABLED;
    process.env.OS_MCP_STDIO_API_KEY = 'osk_settings_bind_window_pin';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  // ── The fixture is falsifiable ────────────────────────────────────────────
  // Without this, every green below could mean "the double always answers
  // zh-CN" rather than "the read landed after the bind".
  it('the settings double answers the MANIFEST DEFAULTS before its engine binds', async () => {
    const double = createSettingsDouble();
    const before = await (double.service.getMany as (n: string, k: string[]) => Promise<Record<string, { value: string; source: string }>>)(
      'localization',
      ['timezone', 'locale', 'currency'],
    );
    expect(before.timezone?.value).toBe('UTC');
    expect(before.locale?.value).toBe('en-US');
    expect(before.timezone?.source).toBe('default');
    expect(before.currency).toBeUndefined();

    double.bind();
    const after = await (double.service.getMany as (n: string, k: string[]) => Promise<Record<string, { value: string; source: string }>>)(
      'localization',
      ['timezone', 'locale', 'currency'],
    );
    expect(after.locale?.value).toBe('zh-CN');
    expect(after.timezone?.value).toBe('Asia/Shanghai');
  });

  // ── The ordering sweep ────────────────────────────────────────────────────
  it.each(ORDERS.map((order) => [order.join(' → '), order] as const))(
    'composition %s: the CONFIGURED locale reaches the transport',
    async (_name, order) => {
      const { context, settings, startOrder } = await bootAndRead(order);

      // The card's payload: the persisted value, not the manifest default.
      expect(context.locale).toBe('zh-CN');
      expect(context.timezone).toBe('Asia/Shanghai');
      expect(context.currency).toBe('CNY');

      // …and it got there by reading AFTER the bind, not by luck.
      expect(settings.reads.length).toBeGreaterThan(0);
      expect(settings.reads.map((r) => r.phase)).not.toContain('pre-bind');
      expect(settings.readsAtBind).toBe(0);

      // The arrangement this case actually exercised — measured, so a kernel
      // that normalized every permutation into one order fails here rather
      // than collapsing the sweep into a single repeated case.
      const realized = startOrder.filter((name) => order.some((k) => KEY_OF[name] === k));
      expect(realized.map((name) => KEY_OF[name])).toEqual([...order]);
    },
  );

  // ── The read's PHASE, stated directly ─────────────────────────────────────
  it('takes no settings read in start() or in any kernel:ready handler', async () => {
    const { settings } = await bootAndRead(['mcp', 'objectql', 'metadata', 'settings']);

    // `readsAtBind` is the count at the moment the settings engine bound — i.e.
    // everything `init()`, every `start()` body, and every `kernel:ready`
    // handler registered before the provider's own had taken by then. The
    // defect's signature is this number being 1.
    expect(settings.readsAtBind).toBe(0);
    expect(settings.reads).toHaveLength(1);
    expect(settings.reads[0]!.phase).toBe('bound');
    expect(settings.reads[0]!.namespace).toBe('localization');
  });

  // ── #7279's property survives the move ────────────────────────────────────
  it('still resolves localization ONCE for the life of the transport', async () => {
    const { settings, context } = await bootAndRead(['settings', 'objectql', 'metadata', 'mcp'], 5);

    // Moving the read must not turn it into a per-call cost on a long-lived
    // process — the counterweight to the fix (#7279).
    expect(settings.reads).toHaveLength(1);
    expect(context.locale).toBe('zh-CN');
  });
});
