// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pre-bind window, READ half (#10250) — **a read that answers with the
 * manifest default while a persisted `sys_setting` row sits unread.**
 *
 * ## The defect
 *
 * `SettingsService.loadRows` picks its store on `if (this.engine)`, exactly as
 * `upsertRow` does, and the engine is bound in one place: `SettingsServicePlugin`
 * registers a `kernel:ready` hook from its `start()` and calls `bindEngine`
 * inside it. A `get()` / `getNamespace()` issued before that hook runs takes the
 * `this.memory` branch, which at boot holds nothing — so the caller receives the
 * specifier's declared `default`, with `source: 'default'` and `locked: false`,
 * and no diagnostic of any kind, while the operator's saved row is never read.
 *
 * The write half (#10159 / PR #10251) could REFUSE, because an in-window write
 * has no correct outcome. A read does: a setting with genuinely no persisted row
 * must answer the manifest default, and doing so at boot is ordinary. So the
 * fix here is not a refusal — it is that the residual stops being silent.
 *
 * ## What is load-bearing in this file, and which half it is
 *
 * Not the warning. An implementation that warned on EVERY read would pass a
 * warn-only suite and turn every boot of every deployment noisy — the classic
 * way a diagnostic gets added, ignored, and then removed. The load-bearing half
 * is therefore the SILENCE: four separate populations that read the in-memory
 * fallback and must stay quiet, each of which is a real shipped shape rather
 * than a variation on one.
 *
 *   1. an ordinary, correctly-ordered boot  (the reader starts AFTER settings)
 *   2. every read after `bindEngine`
 *   3. a kernel with no `objectql` at all   (`settleWithoutEngine`)
 *   4. a directly constructed `SettingsService` (no declared pending bind)
 *
 * Measured: making the report unconditional keeps case 5 (the warning) green and
 * turns 1-4 red. Neutering the report keeps 1-4 green and turns 5 red. Neither
 * mutation can pass this file.
 *
 * ## Resolution
 *
 * Every subject here is imported RELATIVELY (`./settings-service.js`,
 * `./settings-service-plugin.js`), so vitest resolves them to the sibling `src`
 * files in this same package — not to `dist/`. There is no build step between an
 * edit to `settings-service.ts` and a verdict from this file, and an ablation of
 * it needs no rebuild to be believed.
 */

import { describe, expect, it, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SysSecret, SysSetting } from '@objectstack/platform-objects/system';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import { SettingsServicePlugin, wrapEngineAsSettingsEngine } from './settings-service-plugin.js';

const OWNER_PACKAGE = 'com.objectstack.test.settings-prebind-read-warning';

/**
 * One global key with a declared default and one env-overridable key. The
 * default is what an in-window read wrongly hands back, so it is the value the
 * persisted row must differ from.
 */
const probeManifest: SettingsManifest = {
  namespace: 'read_probe',
  version: 1,
  label: 'Read probe',
  scope: 'global',
  specifiers: [
    { type: 'text', key: 'provider', label: 'Provider', required: false, default: 'log' },
  ],
};

/** The exact line an in-window read must produce. Asserted, not paraphrased. */
const EXPECTED_WARNING =
  "[SettingsService] Pre-bind READ of namespace 'read_probe': the data engine is declared " +
  'but not yet bound, so this read was answered from the in-memory fallback and the ' +
  'manifest defaults — any persisted `sys_setting` row was NOT consulted. Declare ' +
  "optionalDependencies: ['com.objectstack.service.settings'] on the reading plugin so it " +
  'starts after the settings engine binds (earliest safe phase: kernel:bootstrapped).';

// ---------------------------------------------------------------------------
// A driver over plain Maps — the same shape `settings-engine-bind-window.test.ts`
// uses, and for the same reason: the real `ObjectQL` sits on top of it, so what
// these cases measure is the real engine's row state rather than a fake's
// bookkeeping.
// ---------------------------------------------------------------------------

function makeMemoryDriver() {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  let nextId = 0;
  const copy = (r: Record<string, unknown>) => ({ ...r });
  const rowsOf = (object: string) => {
    let s = store.get(object);
    if (!s) { s = new Map(); store.set(object, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return (row[k] ?? null) === (v ?? null);
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(o: string, ast: any) {
      return [...rowsOf(o).values()].filter((r) => matches(r, ast?.where)).map(copy);
    },
    async findOne(o: string, ast: any) {
      for (const r of rowsOf(o).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `row_${nextId}`;
      const row = { ...data, id };
      rowsOf(o).set(id, row);
      return copy(row);
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = rowsOf(o);
      const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return copy(next);
    },
    async upsert(o: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && rowsOf(o).has(id) ? this.update(o, id, data) : this.create(o, data);
    },
    async delete(o: string, id: string) { return rowsOf(o).delete(id); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(o, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(o, ast);
      const s = rowsOf(o);
      for (const r of rows) s.set(r.id as string, { ...s.get(r.id as string), ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(o: string, ast: any) {
      const rows = await this.find(o, ast);
      for (const r of rows) rowsOf(o).delete(r.id as string);
      return rows.length;
    },
    async syncSchema() {}, async dropTable() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rowsOf };
}

/** Publishes `objectql` from `init()`, where the real ObjectQLPlugin does. */
class EnginePlugin implements Plugin {
  name = 'com.objectstack.engine.objectql';
  version = '0.0.0';
  type = 'standard' as const;
  providesServices = ['objectql'];
  constructor(private readonly engine: ObjectQL) {}
  init = async (ctx: PluginContext) => {
    ctx.registerService('objectql', this.engine);
  };
}

/**
 * A reader in the shape the census measured: it registers its `kernel:ready`
 * hook from `start()` and reads a settings namespace from inside it. Whether
 * that read lands inside or outside the window is decided purely by whether
 * this plugin starts before or after `SettingsServicePlugin` — which is the
 * whole point.
 */
class SettingsReadingPlugin implements Plugin {
  name = 'com.objectstack.test.settings-reader';
  version = '0.0.0';
  type = 'standard' as const;
  /** Set when the declaration under test is wanted (the correctly-ordered leg). */
  optionalDependencies?: string[];
  /** `resolved:<json>` — what the in-hook read actually saw. */
  readAtReady?: string;
  engineBoundAtReady?: boolean;

  constructor(opts: { declareSettingsOrder?: boolean } = {}) {
    if (opts.declareSettingsOrder) {
      this.optionalDependencies = ['com.objectstack.service.settings'];
    }
  }

  /** Nothing to register — but the kernel calls `init` on every plugin. */
  init = async () => {};

  start = async (ctx: PluginContext) => {
    ctx.hook('kernel:ready', async () => {
      let svc: SettingsService | undefined;
      try { svc = ctx.getService<SettingsService>('settings'); } catch { /* absent */ }
      if (!svc) return;
      // Reaching into the private field on purpose: "was the engine bound at
      // this instant" is the fact the window is defined by, and there is no
      // public spelling of it.
      this.engineBoundAtReady = Boolean((svc as unknown as { engine?: unknown }).engine);
      const r = await svc.get<string>('read_probe', 'provider');
      this.readAtReady = `resolved:${JSON.stringify(r.value)}`;
    });
  };
}

/**
 * Boot a real kernel with a real `SettingsServicePlugin`, a seeded persisted
 * row, and one reader.
 *
 * `readerFirst` is the ONLY thing that differs between the noisy leg and the
 * quiet leg: it flips `kernel.use()` order. Everything else — the manifest, the
 * seeded row, the plugin options, the logger — is identical, so a difference in
 * the observed behaviour can only come from ordering.
 */
async function bootKernel(opts: {
  readerFirst: boolean;
  declareSettingsOrder?: boolean;
  withEngine?: boolean;
  /** Row seeded into `sys_setting` before boot — the value an in-window read misses. */
  seedPersisted?: string;
}) {
  const withEngine = opts.withEngine !== false;
  const { driver, rowsOf } = makeMemoryDriver();
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [SysSetting, SysSecret]) engine.registry.registerObject(o as any, OWNER_PACKAGE);

  if (opts.seedPersisted !== undefined) {
    rowsOf('sys_setting').set('seed_1', {
      id: 'seed_1',
      namespace: 'read_probe',
      key: 'provider',
      scope: 'global',
      user_id: null,
      value: opts.seedPersisted,
      value_enc: null,
      encrypted: false,
      locked: false,
      locked_reason: null,
      updated_at: new Date().toISOString(),
      updated_by: null,
    });
  }

  const reader = new SettingsReadingPlugin({ declareSettingsOrder: opts.declareSettingsOrder });
  const settings = new SettingsServicePlugin({
    registerRoutes: false,
    manifests: [probeManifest],
    actionHandlers: {},
  });

  const kernel = new LiteKernel({ logger: { level: 'error' } as never });
  // `SettingsServicePlugin.init` stores `ctx.logger`, and `createContext()`
  // captures the kernel's OWN logger instance by reference — so the spy has to
  // replace the METHOD on that instance rather than swap the field, which the
  // already-built context would never see. Same object, so this is what the
  // service really calls.
  const kernelLogger = (kernel as unknown as {
    logger: { warn: (message: string, meta?: unknown) => void };
  }).logger;
  const warn = vi.spyOn(kernelLogger, 'warn').mockImplementation(() => {});

  if (withEngine) kernel.use(new EnginePlugin(engine));
  if (opts.readerFirst) { kernel.use(reader); kernel.use(settings); }
  else { kernel.use(settings); kernel.use(reader); }
  await kernel.bootstrap();

  return {
    kernel,
    reader,
    warn,
    svc: kernel.getService<SettingsService>('settings'),
    preBindWarnings: () => warn.mock.calls.map((c) => c[0]).filter((m) =>
      String(m).includes('Pre-bind READ')),
  };
}

// ---------------------------------------------------------------------------
// 5. The window is AUDIBLE — the one case that must be noisy
// ---------------------------------------------------------------------------

describe('a settings read inside the pre-bind window warns', () => {
  it('warns with the operator-actionable line, and the read really did miss the persisted row', async () => {
    const { reader, preBindWarnings } = await bootKernel({
      readerFirst: true,
      seedPersisted: 'twilio',
    });

    // The window, measured on the reader itself.
    expect(reader.engineBoundAtReady).toBe(false);
    // THE DEFECT, still observable: the read answered with the manifest default
    // (`log`) while `sys_setting` held `twilio`. The fix does NOT change this —
    // that is deliberate (#10159's fix left reads open on purpose) — so this
    // assertion is the reason the warning has to exist at all.
    expect(reader.readAtReady).toBe('resolved:"log"');

    // THE DIRECTION PIN: the residual is audible. Asserted as the WHOLE line,
    // not "a warn happened" — a diagnostic whose text nobody pins is one nobody
    // can act on, and the repair instruction is the part that makes it useful.
    const warnings = preBindWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toBe(EXPECTED_WARNING);
    expect(warnings[0]).toContain("optionalDependencies: ['com.objectstack.service.settings']");
    expect(warnings[0]).toContain('kernel:bootstrapped');
  });

  it('reports once per namespace, not once per key', async () => {
    // `getNamespace()` resolves every specifier through `get()`, so a naive
    // report would emit one identical line per declared key. One actionable
    // line survives being read; a dozen get filtered.
    const svc = new SettingsService({ env: {}, engineBindPending: true, logger: { warn: vi.fn() } });
    const spy = (svc as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger.warn;
    svc.registerManifest({
      ...probeManifest,
      specifiers: [
        { type: 'text', key: 'provider', label: 'P', required: false, default: 'log' },
        { type: 'text', key: 'region', label: 'R', required: false, default: 'us' },
        { type: 'text', key: 'sender', label: 'S', required: false, default: 'os' },
      ],
    });
    await svc.getNamespace('read_probe');
    await svc.getNamespace('read_probe');
    expect(spy.mock.calls.filter((c) => String(c[0]).includes('Pre-bind READ'))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 1-4. STILL QUIET — the load-bearing half. Each is a distinct shipped shape.
// ---------------------------------------------------------------------------

describe('a correctly-ordered boot stays silent', () => {
  it('1. the reader declaring the settings order reads the PERSISTED row and warns nothing', async () => {
    // Registered FIRST via `kernel.use()`, exactly like the noisy case — the
    // declaration is the only difference, and it is what moves the order.
    const { reader, preBindWarnings } = await bootKernel({
      readerFirst: true,
      declareSettingsOrder: true,
      seedPersisted: 'twilio',
    });

    expect(reader.engineBoundAtReady).toBe(true);
    // The whole point of the ordering fix, stated as a value: the operator's
    // saved row, not the manifest default.
    expect(reader.readAtReady).toBe('resolved:"twilio"');
    expect(preBindWarnings()).toEqual([]);
  });

  it('1b. plain slate order (settings mounted first) is silent too', async () => {
    // The incidental ordering the always-on slate provides today. It must not
    // become noisy just because a declaration now exists.
    const { reader, preBindWarnings } = await bootKernel({
      readerFirst: false,
      seedPersisted: 'twilio',
    });
    expect(reader.engineBoundAtReady).toBe(true);
    expect(reader.readAtReady).toBe('resolved:"twilio"');
    expect(preBindWarnings()).toEqual([]);
  });

  it('2. reads after bind — the ordinary steady state — warn nothing', async () => {
    const { svc, warn } = await bootKernel({ readerFirst: false, seedPersisted: 'twilio' });
    warn.mockClear();
    for (let i = 0; i < 5; i++) await svc.get('read_probe', 'provider');
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('Pre-bind READ'))).toEqual([]);
  });

  it('3. a kernel with NO objectql settles the window — the memory fallback IS the store', async () => {
    // `SettingsServicePlugin` declares `objectql` OPTIONAL and degrades on
    // purpose. On such a kernel no engine is ever coming, so reading the
    // fallback is correct rather than premature, and warning would make every
    // lean/embedded boot noisy forever.
    const { svc, preBindWarnings } = await bootKernel({ readerFirst: false, withEngine: false });
    await svc.get('read_probe', 'provider');
    await svc.getNamespace('read_probe');
    expect(preBindWarnings()).toEqual([]);
  });

  it('4. a directly constructed SettingsService declares no pending bind and stays quiet', async () => {
    // "unit tests, bootstrap, control-plane mock" — the documented second
    // reading of the in-memory fallback. Only `SettingsServicePlugin` sets
    // `engineBindPending`, so the report never arms here.
    const warn = vi.fn<(message: string) => void>();
    const svc = new SettingsService({ env: {}, logger: { warn } });
    svc.registerManifest(probeManifest);
    await svc.set('read_probe', 'provider', 'memory-is-the-store');
    expect((await svc.get<string>('read_probe', 'provider')).value).toBe('memory-is-the-store');
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('Pre-bind READ'))).toEqual([]);
  });

  it('5. an in-window read satisfied by an OS_* env override is correct, and silent', async () => {
    // Env outranks every persisted scope, so this answer is right whether or
    // not the engine is bound — `get()` returns before ever reaching
    // `loadRows`. Reporting it would train operators to ignore the line.
    const warn = vi.fn<(message: string) => void>();
    const svc = new SettingsService({
      env: { OS_READ_PROBE_PROVIDER: 'from-env' },
      engineBindPending: true,
      logger: { warn },
    });
    svc.registerManifest(probeManifest);
    const r = await svc.get<string>('read_probe', 'provider');
    expect(r.value).toBe('from-env');
    expect(r.source).toBe('env');
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('Pre-bind READ'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The window CLOSES — a service that warned once stops warning after bind
// ---------------------------------------------------------------------------

describe('the report is scoped to the window, not to engine-less-ness', () => {
  it('warns before bindEngine and never again after it', async () => {
    const { driver } = makeMemoryDriver();
    const engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of [SysSetting, SysSecret]) engine.registry.registerObject(o as any, OWNER_PACKAGE);

    const warn = vi.fn<(message: string) => void>();
    const svc = new SettingsService({ env: {}, engineBindPending: true, logger: { warn } });
    svc.registerManifest(probeManifest);

    await svc.get('read_probe', 'provider');
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('Pre-bind READ'))).toHaveLength(1);

    svc.bindEngine(wrapEngineAsSettingsEngine(engine as never));
    warn.mockClear();
    // A DIFFERENT namespace, so the per-namespace dedupe cannot be what makes
    // this silent — only the closed window can.
    svc.registerManifest({ ...probeManifest, namespace: 'read_probe_2' });
    await svc.get('read_probe_2', 'provider');
    await svc.get('read_probe', 'provider');
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('Pre-bind READ'))).toEqual([]);
  });
});
