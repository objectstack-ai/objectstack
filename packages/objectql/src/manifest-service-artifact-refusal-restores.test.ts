// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A refused multi-package artifact leaves the running kernel as it was.
 *
 * ## What was wrong
 *
 * The engine's `manifest` service registers an artifact's packages one by one
 * (`registerApp`, in the order `resolveArtifactPackageEntries` gives). Each
 * `registerApp` puts back what ITS OWN body wrote when that body is refused,
 * but nothing put back the members registered before it: when a later member
 * was refused, the earlier members stayed registered in the running kernel —
 * package records, objects, apps, navigation contributions, kinds, datasource
 * definitions — while the install door answered `422` and wrote no ledger
 * entry, so a restart dropped them again. The same held for a refusal raised
 * by the artifact's residual (top-level items no body declares), which
 * registers after every body.
 *
 * ## What these pin
 *
 *  - a two-member artifact whose second member is refused — by a registry verb
 *    part-way (an object another package owns, an object name the first member
 *    also defines) or by a judge that reads the body alone (an item wearing
 *    another package's `_packageId`) — leaves NEITHER member registered, and
 *    the refusal keeps its code and status;
 *  - a refusal raised by the residual, after both members registered, leaves
 *    neither member registered;
 *  - an upgrade of an installed artifact whose second member is refused leaves
 *    the installed version of BOTH members serving, whole — the first
 *    member's `1.0.0`, not its refused `2.0.0`;
 *  - CONTROLS: a single-package refusal is answered exactly as before (same
 *    code, status and sentence as `registerApp` alone, nothing of it left);
 *    a clean two-member artifact registers both members, and one with a
 *    residual records the residual owner's origin (a refused one records none).
 *
 * The artifacts arrive after `start()`, through the `manifest` service, the way
 * the marketplace install door hands them over.
 *
 * ## The record-currency follow door (ADR-0144 D2 and D6, amended)
 *
 * The same run ends by asking the follow door once, of every object layer it
 * registered. The last two `describe`s pin it for an install, an upgrade and
 * a reload: a pair another member, the residual or the package's own
 * extension completes is admitted; a bad pair in a body, the residual or a
 * nested plugin is refused 422 and leaves nothing; a cold boot is not asked;
 * a reload is one run, refused whole on a bad pair, while a body refused
 * inside it is still skipped on its own.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';

type ManifestService = { register(artifact: unknown, options?: { source?: 'code' | 'marketplace' }): Promise<void> };

const CORE = 'com.probe.suite.core';
const ADDON = 'com.probe.suite.addon';
const HOLDER = 'com.probe.holder';
/** The artifact's own id, which its residual is filed under. */
const SUITE = 'com.probe.suite';
const PREFIXES = ['suite_'];

const object = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  fields: { title: { type: 'text', label: 'Title' } },
  ...extra,
});

/** The first member: it writes into every registry and engine map `registerApp` reaches. */
const core = (version = '1.0.0', extra: Record<string, unknown> = {}) => ({
  id: CORE,
  name: 'suite_core',
  namespace: 'suitecore',
  version,
  type: 'app',
  objects: [object('suite_core_thing', { label: `core ${version}` })],
  apps: [{
    name: 'suite_core_app',
    label: 'Core',
    navigation: [{ id: 'nav_core', type: 'object', label: 'Core', objectName: 'suite_core_thing' }],
  }],
  pages: [{ name: `suite_core_page_${version.replace(/\./g, '_')}`, label: 'Core page', type: 'app' }],
  datasources: version === '1.0.0'
    ? [{ name: 'suite_ds', driver: 'memory', config: {} }]
    : [{ name: 'suite_ds', driver: 'sqlite', config: {} }, { name: 'suite_ds_new', driver: 'memory', config: {} }],
  navigationContributions: [{ app: 'holder_app', items: [{ id: `suite_nav_${version.replace(/\./g, '_')}`, type: 'url', label: 'Suite', url: '/suite' }] }],
  contributes: { kinds: [{ id: `suite.kind.${version}` }] },
  ...extra,
});

/** The second member, depending on the first, so it registers after it. */
const addon = (version = '1.0.0', extra: Record<string, unknown> = {}) => {
  const { objects = [], ...rest } = extra as { objects?: unknown[] };
  return {
    id: ADDON,
    name: 'suite_addon',
    namespace: 'suiteaddon',
    version,
    type: 'module',
    dependencies: { [CORE]: `^${version}` },
    objects: [object('suite_addon_thing', { label: `addon ${version}` }), ...objects],
    ...rest,
  };
};

const artifact = (members: unknown[], extra: Record<string, unknown> = {}) => ({
  id: SUITE,
  version: (members[0] as { version: string }).version,
  packages: members.map((manifest) => ({ manifest })),
  ...extra,
});

/** What the kernel holds of the suite, read through public verbs. */
function trace(ql: ObjectQL) {
  const registry = ql.registry;
  const ours = (name: unknown) => typeof name === 'string' && PREFIXES.some((p) => name.startsWith(p));
  return {
    packages: [CORE, ADDON].map((id) => `${id}@${registry.getPackage(id)?.manifest?.version ?? '-'}`),
    objects: registry.getAllObjects()
      .filter((o: any) => ours(o.name))
      .map((o: any) => `${o.name}:${registry.getObjectOwner(o.name)?.packageId}:${o.label}`)
      .sort(),
    apps: registry.listItems('app').map((a: any) => a.name).filter(ours).sort(),
    pages: registry.listItems('page').map((p: any) => p.name).filter(ours).sort(),
    nav: registry.getAppNavContributions('holder_app').flatMap((c) => c.items.map((i: any) => `${c.packageId}:${i.id}`)),
    kinds: registry.getAllKinds().map((k) => k.id).filter((id) => id.startsWith('suite.')).sort(),
    datasources: ql.listDatasourceDefs().filter((d) => d.name.startsWith('suite_ds')).map((d) => `${d.name}:${d.driver}`).sort(),
    manifests: [CORE, ADDON].filter((id) => (ql as unknown as { manifests: Map<string, unknown> }).manifests.has(id)),
    manifestVersions: [CORE, ADDON].map((id) => (ql as unknown as { manifests: Map<string, { version?: string }> }).manifests.get(id)?.version ?? '-'),
    namespaces: ['suitecore', 'suiteaddon'].map((ns) => registry.getNamespaceOwner(ns) ?? '-'),
  };
}

const NOTHING = {
  packages: [`${CORE}@-`, `${ADDON}@-`],
  objects: [],
  apps: [],
  pages: [],
  nav: [],
  kinds: [],
  datasources: [],
  manifests: [],
  manifestVersions: ['-', '-'],
  namespaces: ['-', '-'],
};

const kernels: ObjectKernel[] = [];
afterEach(async () => {
  while (kernels.length) {
    const kernel = kernels.pop()!;
    if (kernel.getState() === 'running') await kernel.shutdown();
  }
});

/** A running kernel with the holder package registered; artifacts then arrive late, as an install does. */
async function boot(): Promise<{ ql: ObjectQL; manifest: ManifestService }> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
  kernels.push(kernel);
  await kernel.use(new ObjectQLPlugin());
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  ql.registry.logLevel = 'silent';
  const manifest = kernel.getService<ManifestService>('manifest');
  await manifest.register({
    id: HOLDER,
    name: 'holder',
    namespace: 'holder',
    version: '1.0.0',
    type: 'app',
    objects: [object('holder_thing', { label: 'Holder thing' })],
    apps: [{ name: 'holder_app', label: 'Holder', navigation: [] }],
  });
  return { ql, manifest };
}

/**
 * A kernel whose cold boot registers `atBoot` (a plugin's `start()`, before the
 * registry is sealed), with the `metadata:reloaded` announce a reload arrives
 * through and every warning the kernel logged.
 */
async function bootWith(atBoot: unknown[]) {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
  kernels.push(kernel);
  const warn = vi.spyOn((kernel as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger, 'warn');
  let trigger: ((name: string, payload: unknown) => Promise<void>) | undefined;
  await kernel.use(new ObjectQLPlugin());
  await kernel.use({
    name: 'test.follow-door.boot-packages',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    init: async () => {},
    start: async (ctx: { getService<T>(name: string): T; trigger: (name: string, payload: unknown) => Promise<void> }) => {
      trigger = (name, payload) => ctx.trigger(name, payload);
      const manifest = ctx.getService<ManifestService>('manifest');
      await manifest.register({
        id: HOLDER, name: 'holder', namespace: 'holder', version: '1.0.0', type: 'app',
        objects: [object('holder_thing', { label: 'Holder thing' })],
        apps: [{ name: 'holder_app', label: 'Holder', navigation: [] }],
      });
      for (const m of atBoot) await manifest.register(m);
    },
  } as never);
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  ql.registry.logLevel = 'silent';
  return {
    ql,
    manifest: kernel.getService<ManifestService>('manifest'),
    warn,
    warnings: () => warn.mock.calls.map((c) => String(c[0])),
    reload: (m: unknown) => trigger!('metadata:reloaded', { metadata: m }),
  };
}

async function refusal(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the artifact to be refused');
}

/** Each way the second member is refused, with the code and status the refusal keeps. */
const ADDON_REFUSALS: Array<{ label: string; extra: Record<string, unknown>; code: string; status: number; says: string }> = [
  {
    label: 'an object another installed package owns (a registry verb, part-way)',
    extra: { objects: [object('holder_thing')] },
    code: 'OBJECT_OWNERSHIP_CONFLICT', status: 422, says: `Object "holder_thing" is already owned by package "${HOLDER}"`,
  },
  {
    label: 'an object name the first member also defines (the artifact\'s own conflict)',
    extra: { objects: [object('suite_core_thing')] },
    code: 'DUPLICATE_ARTIFACT_OBJECT_NAME', status: 422, says: 'Object name conflict inside one release artifact',
  },
  {
    label: 'a page wearing another package\'s `_packageId` (judged from the body alone)',
    extra: { pages: [{ name: 'suite_addon_page', label: 'Addon page', type: 'app', _packageId: HOLDER }] },
    code: 'VALIDATION_ERROR', status: 400, says: 'suite_addon_page',
  },
];

describe('a refused member of a multi-package artifact leaves no member of it registered', () => {
  for (const c of ADDON_REFUSALS) {
    it(`a fresh install whose second member is refused: ${c.label}`, async () => {
      const { ql, manifest } = await boot();

      const err = await refusal(() => manifest.register(artifact([core(), addon('1.0.0', c.extra)]), { source: 'marketplace' }));

      expect(err).toMatchObject({ code: c.code, status: c.status });
      expect(String(err?.message)).toContain(c.says);
      expect(trace(ql)).toEqual(NOTHING);
      // The holder is as it was.
      expect(ql.registry.getObjectOwner('holder_thing')?.packageId).toBe(HOLDER);
      expect((ql.registry.getObject('holder_thing') as any)?.label).toBe('Holder thing');
    });
  }

  it('a refusal the artifact\'s residual raises, after both members registered', async () => {
    const { ql, manifest } = await boot();

    const err = await refusal(() => manifest.register(
      artifact([core(), addon()], { views: [{ name: 'suite_residual_view', viewKind: 'list', config: {} }] }),
      { source: 'marketplace' },
    ));

    expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    expect(trace(ql)).toEqual(NOTHING);
    // …and records no origin for the residual's owner: a refused artifact
    // states nothing about where an id it never registered came from.
    expect(ql.residualOwnerSource(SUITE)).toBeUndefined();
  });
});

describe('a refused upgrade of a multi-package artifact leaves the installed version of every member serving', () => {
  for (const c of ADDON_REFUSALS) {
    it(`the second member of 2.0.0 is refused: ${c.label}`, async () => {
      const { ql, manifest } = await boot();
      await manifest.register(artifact([core(), addon()]), { source: 'marketplace' });
      const before = trace(ql);
      expect(before.packages).toEqual([`${CORE}@1.0.0`, `${ADDON}@1.0.0`]);

      const err = await refusal(() => manifest.register(
        artifact([
          core('2.0.0', { objects: [object('suite_core_thing', { label: 'core 2.0.0' }), object('suite_core_new')] }),
          addon('2.0.0', c.extra),
        ]),
        { source: 'marketplace' },
      ));

      expect(err).toMatchObject({ code: c.code, status: c.status });
      expect(trace(ql)).toEqual(before);
      expect(trace(ql).manifestVersions).toEqual(['1.0.0', '1.0.0']);
      expect(trace(ql).datasources).toEqual(['suite_ds:memory']);
    });
  }
});

describe('CONTROLS', () => {
  it('a single-package refusal is answered as `registerApp` alone answers it, and leaves nothing of it', async () => {
    const body = () => core('1.0.0', { objects: [object('suite_core_thing'), object('holder_thing')] });
    const { ql, manifest } = await boot();

    const err = await refusal(() => manifest.register(body(), { source: 'marketplace' }));

    // The same refusal a bare engine raises for the same body over the same holder.
    const bare = new ObjectQL();
    bare.registry.logLevel = 'silent';
    bare.registerApp({ id: HOLDER, name: 'holder', namespace: 'holder', version: '1.0.0', objects: [object('holder_thing')] });
    let direct: any;
    try { bare.registerApp(body(), undefined, 'marketplace'); } catch (e) { direct = e; }
    expect(direct).toBeDefined();
    expect(err).toMatchObject({ code: direct.code, status: direct.status, message: direct.message });
    expect(err).toMatchObject({ code: 'OBJECT_OWNERSHIP_CONFLICT', status: 422 });
    expect(trace(ql)).toEqual(NOTHING);
  });

  it('a clean two-member artifact registers both members', async () => {
    const { ql, manifest } = await boot();

    await manifest.register(artifact([core(), addon()]), { source: 'marketplace' });

    expect(trace(ql)).toMatchObject({
      packages: [`${CORE}@1.0.0`, `${ADDON}@1.0.0`],
      objects: [`suite_addon_thing:${ADDON}:addon 1.0.0`, `suite_core_thing:${CORE}:core 1.0.0`],
      nav: [`${CORE}:suite_nav_1_0_0`],
      kinds: ['suite.kind.1.0.0'],
      datasources: ['suite_ds:memory'],
      manifests: [CORE, ADDON],
    });
  });

  it('a clean artifact with a residual registers it and records the residual owner\'s origin', async () => {
    const { ql, manifest } = await boot();

    await manifest.register(artifact([core(), addon()], { objects: [object('suite_residual_thing')] }), { source: 'marketplace' });

    expect(ql.registry.getObjectOwner('suite_residual_thing')?.packageId).toBe(SUITE);
    expect(ql.residualOwnerSource(SUITE)).toBe('marketplace');
  });
});

// ── [ADR-0144 D2 and D6, amended] The record-currency follow door, at the end of the run ──
//
// A running install, upgrade or reload registers several object layers, and a
// pair of them is whole only once all have registered: a package's
// `objectExtensions` after its `objects`, a later member of the artifact, its
// residual, a nested plugin. So the registry asks the follow door ONCE, at the
// end of the outermost registration run, of every layer the run registered
// (`SchemaRegistry.restoringOnRefusal`). Asked any earlier — at each
// registration, or at the end of each body — the admitted cases below are
// refused; never asked, the refused ones install.

const LEDGER = 'com.probe.ledger';
const CODE = { type: 'text', label: 'Currency', valueDomain: 'iso_4217_currency' };
const FOLLOW_REFUSED = { name: 'RecordCurrencyFollowRefusedError', code: 'INVALID_METADATA', status: 422, httpStatus: 422 };

/** The parent, holding an ISO 4217 code under `codeField` (none when omitted). */
const invoice = (codeField?: string, fields: Record<string, unknown> = {}) => object('suite_invoice', {
  fields: { title: { type: 'text', label: 'Title' }, ...(codeField ? { [codeField]: CODE } : {}), ...fields },
});
/** The child, whose amount follows `pointer` through its `invoice` (a plain number when omitted). */
const line = (pointer?: string) => object('suite_line', {
  fields: {
    title: { type: 'text', label: 'Title' },
    invoice: { type: 'master_detail', label: 'Invoice', reference: 'suite_invoice' },
    amount: pointer
      ? { type: 'currency', label: 'Amount', currencyConfig: { currencyMode: 'record', currencyField: pointer } }
      : { type: 'number', label: 'Amount' },
  },
});
/** A `record` roll-up of the child's amount, in the parent's currency. */
const SUBTOTAL = {
  subtotal: {
    type: 'summary',
    label: 'Subtotal',
    currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' },
    summaryOperations: { object: 'suite_line', field: 'amount', function: 'sum' },
  },
};
/** A package installed before the artifact, owning the parent. */
const ledger = (codeField?: string) => ({
  id: LEDGER, name: 'ledger', namespace: 'ledger', version: '1.0.0', type: 'module', objects: [invoice(codeField)],
});
/** Another vendor's package, holding only the child. */
const BILLING = 'com.probe.billing';
const billing = (objects: unknown[], version = '1.0.0') => ({
  id: BILLING, name: 'billing', namespace: 'billing', version, type: 'module', objects,
});
/** The first member with `objects` beside its own. */
const coreWith = (version: string, objects: unknown[], extra: Record<string, unknown> = {}) =>
  core(version, { objects: [object('suite_core_thing', { label: `core ${version}` }), ...objects], ...extra });
const EXTENDS_CODE = { objectExtensions: [{ extend: 'suite_invoice', fields: { currency_code: CODE } }] };

const fieldOf = (ql: ObjectQL, objectName: string, field: string): any =>
  (ql.registry.getObject(objectName)?.fields as Record<string, unknown> | undefined)?.[field];
const followedBy = (ql: ObjectQL) => fieldOf(ql, 'suite_line', 'amount')?.currencyConfig?.currencyField;

describe('a running install is asked the record-currency follow door once, at the end of its run (ADR-0144 D2 and D6, amended)', () => {
  it('a package whose own `objectExtensions` supplies the parent\'s code field installs', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger());

    // The body's object registers before its extension: asked at that
    // registration, the child follows a code the parent does not hold yet.
    await manifest.register(coreWith('1.0.0', [line('invoice.currency_code')], EXTENDS_CODE), { source: 'marketplace' });

    expect(ql.registry.getObjectOwner('suite_line')?.packageId).toBe(CORE);
    expect(fieldOf(ql, 'suite_invoice', 'currency_code')?.valueDomain).toBe('iso_4217_currency');
  });

  it('…and so does an artifact whose LATER member supplies it: no body is asked at its own end', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger());

    await manifest.register(
      artifact([coreWith('1.0.0', [line('invoice.currency_code')]), addon('1.0.0', EXTENDS_CODE)]),
      { source: 'marketplace' },
    );

    expect(trace(ql).packages).toEqual([`${CORE}@1.0.0`, `${ADDON}@1.0.0`]);
    expect(fieldOf(ql, 'suite_invoice', 'currency_code')?.valueDomain).toBe('iso_4217_currency');
  });

  it('…and an upgrade whose RESIDUAL supplies it, while a body starts following it', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(artifact([coreWith('1.0.0', [line()]), addon()], { objects: [invoice()] }), { source: 'marketplace' });
    expect(ql.registry.getObjectOwner('suite_invoice')?.packageId).toBe(SUITE);

    // The residual registers after every body: at the end of the first body
    // the child follows `currency_code` of the parent 1.0.0 left, which holds none.
    await manifest.register(
      artifact([coreWith('2.0.0', [line('invoice.currency_code')]), addon('2.0.0')], { objects: [invoice('currency_code')] }),
      { source: 'marketplace' },
    );

    expect(trace(ql).packages).toEqual([`${CORE}@2.0.0`, `${ADDON}@2.0.0`]);
    expect(followedBy(ql)).toBe('invoice.currency_code');
    expect(fieldOf(ql, 'suite_invoice', 'currency_code')?.valueDomain).toBe('iso_4217_currency');
  });

  it('an upgrade that renames the code field in one member and re-points the amount in another installs: the parent judged is the new one', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(
      artifact([coreWith('1.0.0', [invoice('currency_code')]), addon('1.0.0', { objects: [line('invoice.currency_code')] })]),
      { source: 'marketplace' },
    );

    // The parent registers first: asked there, the installed child still
    // follows `currency_code`, which the incoming parent no longer holds.
    await manifest.register(
      artifact([coreWith('2.0.0', [invoice('billing_code')]), addon('2.0.0', { objects: [line('invoice.billing_code')] })]),
      { source: 'marketplace' },
    );

    expect(trace(ql).packages).toEqual([`${CORE}@2.0.0`, `${ADDON}@2.0.0`]);
    expect(followedBy(ql)).toBe('invoice.billing_code');
    expect(fieldOf(ql, 'suite_invoice', 'currency_code')).toBeUndefined();
  });

  /** Each place a bad pair can arrive from; the parent holds `currency_code`, and `title` holds no ISO 4217 code. */
  const BAD_PAIRS: Array<{ label: string; build: () => unknown; object: string; field: string }> = [
    {
      label: 'in a body: its amount follows a parent field that holds no ISO 4217 code',
      build: () => artifact([coreWith('1.0.0', [invoice('currency_code')]), addon('1.0.0', { objects: [line('invoice.title')] })]),
      object: 'suite_line', field: 'amount',
    },
    {
      label: 'in the residual: a top-level object no body declares',
      build: () => artifact([coreWith('1.0.0', [invoice('currency_code')]), addon()], { objects: [line('invoice.title')] }),
      object: 'suite_line', field: 'amount',
    },
    {
      label: 'in a nested plugin\'s objects (one package, as the body door takes it)',
      build: () => coreWith('1.0.0', [invoice('currency_code')], { plugins: [{ name: 'suite_inner', objects: [line('invoice.title')] }] }),
      object: 'suite_line', field: 'amount',
    },
    {
      label: 'across two members: a `record` roll-up over a child amount that follows nothing',
      build: () => artifact([coreWith('1.0.0', [invoice('currency_code', SUBTOTAL)]), addon('1.0.0', { objects: [line()] })]),
      object: 'suite_invoice', field: 'subtotal',
    },
  ];
  for (const c of BAD_PAIRS) {
    it(`a bad pair is refused 422 and leaves nothing of the artifact — ${c.label}`, async () => {
      const { ql, manifest } = await boot();

      const err = await refusal(() => manifest.register(c.build(), { source: 'marketplace' }));

      expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: c.object, fieldName: c.field });
      expect(trace(ql)).toEqual(NOTHING);
      expect(ql.registry.getObject('suite_invoice')).toBeUndefined();
      expect(ql.registry.getObject('suite_line')).toBeUndefined();
      expect(ql.residualOwnerSource(SUITE)).toBeUndefined();
    });
  }

  it('a bad pair with the parent another installed package owns is refused the same way, and that package reads as it did', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger('currency_code'));

    const err = await refusal(() => manifest.register(coreWith('1.0.0', [line('invoice.currency')]), { source: 'marketplace' }));

    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'amount' });
    expect(String(err?.message)).toContain("'suite_invoice' declares no field 'currency'");
    expect(trace(ql)).toEqual({ ...NOTHING, objects: [`suite_invoice:${LEDGER}:suite_invoice`] });
  });

  it('a refused upgrade leaves the installed version of every member serving: the parent drops the code a later member still follows', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(
      artifact([coreWith('1.0.0', [invoice('currency_code')]), addon('1.0.0', { objects: [line('invoice.currency_code')] })]),
      { source: 'marketplace' },
    );
    const before = trace(ql);

    const err = await refusal(() => manifest.register(
      artifact([coreWith('2.0.0', [invoice()]), addon('2.0.0', { objects: [line('invoice.currency_code')] })]),
      { source: 'marketplace' },
    ));

    expect(err).toMatchObject(FOLLOW_REFUSED);
    expect(String(err?.message)).toContain("'suite_invoice' declares no field 'currency_code'");
    expect(trace(ql)).toEqual(before);
    expect(trace(ql).packages).toEqual([`${CORE}@1.0.0`, `${ADDON}@1.0.0`]);
    expect(fieldOf(ql, 'suite_invoice', 'currency_code')?.valueDomain).toBe('iso_4217_currency');
  });

  it('a package upgraded under the environment\'s own object of the parent\'s name, which holds the followed code, installs: that object is what is served', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger());
    // The environment's own `suite_invoice` is served over the package's and holds the code field; its own child follows it.
    ql.registry.registerObject({ ...invoice('currency_code'), _provenance: 'org' } as never, 'sys_metadata', undefined, 'overlay');
    ql.registry.registerObject(line('invoice.currency_code') as never, 'sys_metadata');

    // The owner beneath the overlay is not what is served, so it is not asked.
    await manifest.register({ ...ledger(), version: '2.0.0' });

    expect(ql.registry.getPackage(LEDGER)?.manifest?.version).toBe('2.0.0');
    expect(fieldOf(ql, 'suite_invoice', 'currency_code')?.valueDomain).toBe('iso_4217_currency');
  });

  it('CONTROL: the same upgrade with no overlay is refused: the owner is what is served', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger('currency_code'));
    ql.registry.registerObject(line('invoice.currency_code') as never, 'sys_metadata');

    const err = await refusal(() => manifest.register({ ...ledger(), version: '2.0.0' }));

    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'amount' });
    expect(ql.registry.getPackage(LEDGER)?.manifest?.version).toBe('1.0.0');
    expect(fieldOf(ql, 'suite_invoice', 'currency_code')?.valueDomain).toBe('iso_4217_currency');
  });

  it('[#33593 R7] a package that holds only the parent installs an upgrade that changes nothing in the pair, though a child another package holds follows a code it lacks', async () => {
    // The other package's child got in at a cold boot, which is not asked: it
    // follows `currency_code`, and the ledger's parent holds no such field.
    const { ql, manifest } = await bootWith([ledger(), billing([line('invoice.currency_code')])]);
    expect(followedBy(ql)).toBe('invoice.currency_code');

    // The ledger's next version re-registers the same parent: the pair is as
    // the upgrade found it, so the upgrade is not what breaks it.
    await manifest.register({ ...ledger(), version: '2.0.0' });

    expect(ql.registry.getPackage(LEDGER)?.manifest?.version).toBe('2.0.0');
    expect(ql.registry.getObjectOwner('suite_line')?.packageId).toBe(BILLING);
    expect(followedBy(ql)).toBe('invoice.currency_code');
  });

  it('[#33593 R7] …and a package that holds only the child installs an unchanged child under a `record` roll-up another package holds', async () => {
    // At the cold boot the ledger's parent totals, in its own currency, an
    // amount of the other package's child that follows no record's currency.
    const { ql, manifest } = await bootWith([
      billing([line()]),
      { ...ledger(), objects: [invoice('currency_code', SUBTOTAL)] },
    ]);
    expect(fieldOf(ql, 'suite_invoice', 'subtotal')?.currencyConfig?.currencyMode).toBe('record');

    // The child's package re-registers the same child.
    await manifest.register(billing([line()], '1.1.0'));

    expect(ql.registry.getPackage(BILLING)?.manifest?.version).toBe('1.1.0');
  });

  it('[#33593 R6] CONTROL: the child\'s upgrade that CHANGES the pair is still refused under that roll-up', async () => {
    const { ql, manifest } = await bootWith([
      billing([line('invoice.currency_code')]),
      { ...ledger(), objects: [invoice('currency_code', SUBTOTAL)] },
    ]);

    // 1.1.0 makes the amount follow nothing: the roll-up over it is now the upgrade's to answer for.
    const err = await refusal(() => manifest.register(billing([line()], '1.1.0')));

    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_invoice', fieldName: 'subtotal' });
    expect(ql.registry.getPackage(BILLING)?.manifest?.version).toBe('1.0.0');
    expect(followedBy(ql)).toBe('invoice.currency_code');
  });

  it('[#33593 R6] CONTROL: the child\'s upgrade that re-points the pair onto ANOTHER parent lacking the code is refused, though the pointer reads the same', async () => {
    // The cold boot admits the amount following `invoice.title` of
    // `suite_invoice`, which holds no code; `suite_other` holds none either.
    const { ql, manifest } = await bootWith([
      { ...ledger(), objects: [invoice(), object('suite_other')] },
      billing([line('invoice.title')]),
    ]);

    // 1.1.0 changes only the master_detail's reference: the pointer is the
    // same string, but the pair it makes is new, so the upgrade answers for it.
    const repointed = line('invoice.title');
    (repointed.fields as Record<string, any>).invoice = { type: 'master_detail', label: 'Invoice', reference: 'suite_other' };
    const err = await refusal(() => manifest.register(billing([repointed], '1.1.0')));

    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'amount' });
    expect(String(err?.message)).toContain("'suite_other.title'");
    expect(ql.registry.getPackage(BILLING)?.manifest?.version).toBe('1.0.0');
    expect(fieldOf(ql, 'suite_line', 'invoice')?.reference).toBe('suite_invoice');
  });

  /** What the refusal adds when only the environment's own object of the name, served over the package's, earns it. */
  const OVER_ENVIRONMENT_OBJECT = "On this server 'suite_invoice' is served from the environment's own object of that name, "
    + "which lies over the one a package ships. Read against the package's own definition this pair is not refused, "
    + 'so the correction above does not apply here, and the product has no remedy for it today.';

  it('an upgrade whose new child follows a code field the environment\'s own object of the parent\'s name does not hold is refused, and the refusal says the package is not what is wrong', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger());
    // The environment's own `suite_invoice` is served over the package's, and holds no code field.
    ql.registry.registerObject({ ...invoice(), label: 'Customer invoice', _provenance: 'org' } as never, 'sys_metadata', undefined, 'overlay');

    const err = await refusal(() => manifest.register({
      ...ledger('currency_code'), version: '2.0.0',
      objects: [invoice('currency_code'), line('invoice.currency_code')],
    }));

    // The pair is judged against the served parent, as a single save judges
    // it: every write of the amount would be refused for want of a code.
    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'amount' });
    expect(String(err?.message)).toContain("'suite_invoice' declares no field 'currency_code'");
    // The package's own parent holds the code: the sentence says so, and names no remedy.
    expect(String(err?.message).endsWith(OVER_ENVIRONMENT_OBJECT)).toBe(true);
    expect(ql.registry.getPackage(LEDGER)?.manifest?.version).toBe('1.0.0');
    expect(ql.registry.getObject('suite_line')).toBeUndefined();
    expect((ql.registry.getObject('suite_invoice') as any)?.label).toBe('Customer invoice');
  });

  it('CONTROL: a pair the package\'s own parent does not hold either is refused in the door\'s words alone, the environment\'s object or not', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger());
    ql.registry.registerObject({ ...invoice(), label: 'Customer invoice', _provenance: 'org' } as never, 'sys_metadata', undefined, 'overlay');

    // The package's 2.0.0 parent holds `currency_code`; its child follows `currency`, which neither parent holds.
    const err = await refusal(() => manifest.register({
      ...ledger('currency_code'), version: '2.0.0',
      objects: [invoice('currency_code'), line('invoice.currency')],
    }));

    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'amount' });
    expect(String(err?.message)).toContain("'suite_invoice' declares no field 'currency'");
    expect(String(err?.message)).not.toContain('On this server');
    expect(ql.registry.getPackage(LEDGER)?.manifest?.version).toBe('1.0.0');
  });

  it('a cold boot registers the same bad pair unasked, as before: the door is asked only once the boot has sealed the registry', async () => {
    const { ql } = await bootWith([
      artifact([coreWith('1.0.0', [invoice('currency_code')]), addon('1.0.0', { objects: [line('invoice.title')] })]),
    ]);

    expect(trace(ql).packages).toEqual([`${CORE}@1.0.0`, `${ADDON}@1.0.0`]);
    expect(followedBy(ql)).toBe('invoice.title');
  });
});

describe('a reload is one registration run, asked the follow door once at its end (ADR-0144 D2 and D6, amended)', () => {
  const RELOAD_REFUSED = '[ObjectQLPlugin] reload refused — every package and object keeps its previous definition';
  const PACKAGE_SKIPPED = '[ObjectQLPlugin] reload could not re-register a package — its registry entries keep their previous definitions';

  it('a reload that adds the code field in a later member and makes an earlier member\'s child follow it reloads', async () => {
    const v1 = artifact([coreWith('1.0.0', [line()]), addon('1.0.0', { objects: [invoice()] })]);
    const { ql, reload, warnings } = await bootWith([v1]);
    expect(followedBy(ql)).toBeUndefined();

    // The child's package re-registers first: asked at the end of ITS
    // `registerApp`, the child follows a code the served parent does not hold.
    await reload(artifact([
      coreWith('1.0.0', [line('invoice.currency_code')]),
      addon('1.0.0', { objects: [invoice('currency_code')] }),
    ]));

    expect(followedBy(ql)).toBe('invoice.currency_code');
    expect(fieldOf(ql, 'suite_invoice', 'currency_code')?.valueDomain).toBe('iso_4217_currency');
    expect(warnings().filter((w) => w === RELOAD_REFUSED || w === PACKAGE_SKIPPED)).toEqual([]);
  });

  it('a body refused inside the reload is skipped whole while the other packages reload, as before', async () => {
    const { ql, reload, warnings } = await bootWith([artifact([core(), addon()])]);

    await reload(artifact([
      core('1.0.0', { objects: [object('suite_core_thing', { label: 'core reloaded' })] }),
      // Its own object re-registers, then one the holder owns is refused:
      // the package's nested run puts back the first with the second.
      { ...addon(), objects: [object('suite_addon_thing', { label: 'addon reloaded' }), object('holder_thing')] },
    ]));

    expect(trace(ql).objects).toEqual([`suite_addon_thing:${ADDON}:addon 1.0.0`, `suite_core_thing:${CORE}:core reloaded`]);
    expect(ql.registry.getObjectOwner('holder_thing')?.packageId).toBe(HOLDER);
    expect(warnings().filter((w) => w === PACKAGE_SKIPPED)).toHaveLength(1);
    expect(warnings()).not.toContain(RELOAD_REFUSED);
  });

  it('a bad pair refuses the whole reload: every package keeps the definition it served, and the log names the pair', async () => {
    const v1 = artifact([coreWith('1.0.0', [invoice('currency_code')]), addon('1.0.0', { objects: [line('invoice.currency_code')] })]);
    const { ql, reload, warn } = await bootWith([v1]);
    const before = trace(ql);

    // The first member reloads cleanly; the second one's amount follows a field that holds no code.
    await reload(artifact([
      core('1.0.0', { objects: [object('suite_core_thing', { label: 'core reloaded' }), invoice('currency_code')] }),
      addon('1.0.0', { objects: [line('invoice.title')] }),
    ]));

    expect(trace(ql)).toEqual(before);
    expect(followedBy(ql)).toBe('invoice.currency_code');
    const refused = warn.mock.calls.filter((c) => c[0] === RELOAD_REFUSED);
    expect(refused).toHaveLength(1);
    expect(refused[0][1]).toMatchObject({ packageIds: [CORE, ADDON] });
    expect(String((refused[0][1] as { error?: unknown }).error)).toContain('suite_line');
  });

  it('…and so does a bad pair arriving in the reload\'s flat objects, which register in the same run', async () => {
    const v1 = artifact([coreWith('1.0.0', [invoice('currency_code')]), addon('1.0.0', { objects: [line('invoice.currency_code')] })]);
    const { ql, reload, warn } = await bootWith([v1]);
    const before = trace(ql);

    await reload({
      ...artifact([
        core('1.0.0', { objects: [object('suite_core_thing', { label: 'core reloaded' }), invoice('currency_code')] }),
        addon('1.0.0', { objects: [line('invoice.currency_code')] }),
      ]),
      objects: [{ ...line('invoice.title'), _packageId: ADDON }],
    });

    expect(trace(ql)).toEqual(before);
    expect(followedBy(ql)).toBe('invoice.currency_code');
    expect(warn.mock.calls.filter((c) => c[0] === RELOAD_REFUSED)).toHaveLength(1);
  });
});

// ── [#33593 ruling A, amended] An `extend` layer's following amount, judged as the object is served ──
//
// Every object layer is judged as the served fold of its object — the base,
// every enabled extension and the incoming body — never as the bare body
// (R1). So an amount an extension-only package adds is refused at the run
// that adds it, as the same amount in an own body is; the owner registering
// under an extension that arrived first judges the extension's amounts with
// its own (R3); a parent upgrade that breaks an extension's amount is refused
// naming the extension's package (R6); and a run that leaves a pair as it
// found it is never refused over it (R7).

const EXTENDER = 'com.probe.extender';
const SUPPLIER = 'com.probe.supplier';
/** A record-mode amount following `pointer`. */
const follows = (pointer: string) => ({ type: 'currency', label: 'Extra', currencyConfig: { currencyMode: 'record', currencyField: pointer } });
/** A package that only extends `suite_line` with `fields`. */
const extender = (fields: Record<string, unknown>, version = '1.0.0') => ({
  id: EXTENDER, name: 'extender', namespace: 'extender', version, type: 'module',
  objectExtensions: [{ extend: 'suite_line', fields }],
});
/** A package that only extends `suite_invoice` with an ISO 4217 code field. */
const supplier = (version = '1.0.0') => ({
  id: SUPPLIER, name: 'supplier', namespace: 'supplier', version, type: 'module',
  objectExtensions: [{ extend: 'suite_invoice', fields: { currency_code: CODE } }],
});
const extraOf = (ql: ObjectQL) => fieldOf(ql, 'suite_line', 'ext_amount');

describe('[#33593] an extension\'s record-mode amount is judged against its object as served, at the end of the run', () => {
  const BAD_EXTENSIONS: Array<{ label: string; fields: Record<string, unknown>; says: string }> = [
    { label: 'a parent field holding no ISO 4217 code (R1)', fields: { ext_amount: follows('invoice.title') }, says: "'suite_invoice.title'" },
    { label: 'a parent field that does not exist (R1, R4)', fields: { ext_amount: follows('invoice.no_such_field') }, says: "declares no field 'no_such_field'" },
    {
      label: 'a field reached through the extension\'s own new master_detail (R1)',
      fields: {
        inv2: { type: 'master_detail', label: 'Invoice 2', reference: 'suite_invoice' },
        ext_amount: follows('inv2.title'),
      },
      says: "'suite_invoice.title'",
    },
  ];
  for (const c of BAD_EXTENSIONS) {
    it(`an extension-only install following ${c.label} is refused 422, and leaves nothing`, async () => {
      const { ql, manifest } = await boot();
      await manifest.register(ledger('currency_code'));
      await manifest.register(billing([line('invoice.currency_code')]));

      const err = await refusal(() => manifest.register(extender(c.fields), { source: 'marketplace' }));

      expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'ext_amount' });
      expect(String(err?.message)).toContain(c.says);
      expect(extraOf(ql)).toBeUndefined();
      expect(ql.registry.getPackage(EXTENDER)).toBeUndefined();
    });
  }

  it('CONTROL: the extension following the parent\'s code installs, and the served child carries it', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger('currency_code'));
    await manifest.register(billing([line('invoice.currency_code')]));

    await manifest.register(extender({ ext_amount: follows('invoice.currency_code') }), { source: 'marketplace' });

    expect(extraOf(ql)?.currencyConfig?.currencyField).toBe('invoice.currency_code');
  });

  it('CONTROL: the same amount in an own body is refused the same way', async () => {
    const { manifest } = await boot();
    await manifest.register(ledger('currency_code'));

    const err = await refusal(() => manifest.register(billing([
      object('suite_line', { fields: {
        invoice: { type: 'master_detail', label: 'Invoice', reference: 'suite_invoice' },
        ext_amount: follows('invoice.title'),
      } }),
    ])));

    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'ext_amount' });
  });

  it('CONTROL: a package that owns the parent and extends the child in one install is refused the same way', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(billing([line()]));

    const err = await refusal(() => manifest.register({
      ...ledger('currency_code'),
      objectExtensions: [{ extend: 'suite_line', fields: { ext_amount: follows('invoice.title') } }],
    }));

    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'ext_amount' });
    expect(ql.registry.getPackage(LEDGER)).toBeUndefined();
  });

  it('R3: an extension that arrives before its object\'s owner is no verdict (R2), and the owner\'s install that completes the bad pair is refused', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger('currency_code'));
    // `suite_line` is not registered yet: nothing serves it, so nothing is judged.
    await manifest.register(extender({ ext_amount: follows('invoice.title') }), { source: 'marketplace' });
    expect(ql.registry.getPackage(EXTENDER)).toBeDefined();

    const err = await refusal(() => manifest.register(billing([line('invoice.currency_code')])));

    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'ext_amount' });
    expect(ql.registry.getPackage(BILLING)).toBeUndefined();
    expect(ql.registry.getObject('suite_line')).toBeUndefined();
  });

  it('R3 CONTROL: …and the owner installs over an extension arrived first that follows the code', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger('currency_code'));
    await manifest.register(extender({ ext_amount: follows('invoice.currency_code') }), { source: 'marketplace' });

    await manifest.register(billing([line('invoice.currency_code')]));

    expect(extraOf(ql)?.currencyConfig?.currencyField).toBe('invoice.currency_code');
  });

  it('R4: an extension that arrives before the parent\'s code field exists is refused; once the parent holds it, the same extension installs', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger());
    await manifest.register(billing([line()]));

    const err = await refusal(() => manifest.register(extender({ ext_amount: follows('invoice.currency_code') })));
    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'ext_amount' });
    expect(String(err?.message)).toContain("declares no field 'currency_code'");

    await manifest.register({ ...ledger('currency_code'), version: '1.1.0' });
    await manifest.register(extender({ ext_amount: follows('invoice.currency_code') }));
    expect(extraOf(ql)?.currencyConfig?.currencyField).toBe('invoice.currency_code');
  });

  it('R5: a code field another extension supplies is read from the served parent: missing, the amount is refused; installed, it installs', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger());
    await manifest.register(billing([line()]));

    const err = await refusal(() => manifest.register(extender({ ext_amount: follows('invoice.currency_code') })));
    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'ext_amount' });

    await manifest.register(supplier());
    await manifest.register(extender({ ext_amount: follows('invoice.currency_code') }));
    expect(extraOf(ql)?.currencyConfig?.currencyField).toBe('invoice.currency_code');
  });

  it('R5: …a disabled supplier is no supplier: the amount is refused', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger());
    await manifest.register(billing([line()]));
    await manifest.register(supplier());
    ql.registry.disablePackage(SUPPLIER);
    expect(fieldOf(ql, 'suite_invoice', 'currency_code')).toBeUndefined();

    const err = await refusal(() => manifest.register(extender({ ext_amount: follows('invoice.currency_code') })));

    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'ext_amount' });
  });

  it('R5: …and the supplier and the amount in ONE artifact pass at the run end', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger());
    await manifest.register(billing([line()]));

    await manifest.register(artifact([
      core('1.0.0', { objectExtensions: [{ extend: 'suite_line', fields: { ext_amount: follows('invoice.currency_code') } }] }),
      addon('1.0.0', { objectExtensions: [{ extend: 'suite_invoice', fields: { currency_code: CODE } }] }),
    ]));

    expect(extraOf(ql)?.currencyConfig?.currencyField).toBe('invoice.currency_code');
    expect(fieldOf(ql, 'suite_invoice', 'currency_code')?.valueDomain).toBe('iso_4217_currency');
  });

  it('R6: a parent upgrade that removes the code field an extension\'s amount follows is refused, naming the extension\'s package and field', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger('currency_code'));
    await manifest.register(billing([line()]));
    await manifest.register(extender({ ext_amount: follows('invoice.currency_code') }));

    const err = await refusal(() => manifest.register({ ...ledger(), version: '2.0.0' }));

    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'ext_amount' });
    expect(String(err?.message)).toContain(`'suite_line.ext_amount', which package '${EXTENDER}' adds to 'suite_line'`);
    expect(ql.registry.getPackage(LEDGER)?.manifest?.version).toBe('1.0.0');
    expect(fieldOf(ql, 'suite_invoice', 'currency_code')?.valueDomain).toBe('iso_4217_currency');
  });

  it('R6: …and so is one that de-codes it (the field stays, holding no ISO 4217 code)', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger('currency_code'));
    await manifest.register(billing([line()]));
    await manifest.register(extender({ ext_amount: follows('invoice.currency_code') }));

    const err = await refusal(() => manifest.register({
      ...ledger(), version: '2.0.0', objects: [invoice(undefined, { currency_code: { type: 'text', label: 'Currency' } })],
    }));

    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'ext_amount' });
    expect(String(err?.message)).toContain(`'${EXTENDER}'`);
    expect(ql.registry.getPackage(LEDGER)?.manifest?.version).toBe('1.0.0');
  });

  it('R7: a no-change upgrade of either owner is never refused over an extension\'s amount a cold boot admitted', async () => {
    // The cold boot is not asked, so the bad extension is served.
    const { ql, manifest } = await bootWith([ledger('currency_code'), billing([line()]), extender({ ext_amount: follows('invoice.title') })]);
    expect(extraOf(ql)?.currencyConfig?.currencyField).toBe('invoice.title');

    await manifest.register({ ...ledger('currency_code'), version: '1.0.1' });
    await manifest.register(billing([line()], '1.0.1'));

    expect(ql.registry.getPackage(LEDGER)?.manifest?.version).toBe('1.0.1');
    expect(ql.registry.getPackage(BILLING)?.manifest?.version).toBe('1.0.1');
  });

  it('R7: …and so is the extension package\'s own no-change upgrade over the amount the cold boot admitted', async () => {
    const { ql, manifest } = await bootWith([ledger('currency_code'), billing([line()]), extender({ ext_amount: follows('invoice.title') })]);

    await manifest.register(extender({ ext_amount: follows('invoice.title') }, '1.0.1'));

    expect(ql.registry.getPackage(EXTENDER)?.manifest?.version).toBe('1.0.1');
    expect(extraOf(ql)?.currencyConfig?.currencyField).toBe('invoice.title');
  });

  it('R7: a parent upgrade that only adds an unrelated code field installs over a pair it leaves as it found it', async () => {
    // The cold boot admits an amount following the parent's text field; the
    // refusal sentence lists the parent's code fields, so it moves when the
    // upgrade adds one, while the pair does not.
    const { ql, manifest } = await bootWith([ledger(), billing([line('invoice.title')])]);

    await manifest.register({ ...ledger('cc'), version: '2.0.0' });

    expect(ql.registry.getPackage(LEDGER)?.manifest?.version).toBe('2.0.0');
    expect(fieldOf(ql, 'suite_invoice', 'cc')?.valueDomain).toBe('iso_4217_currency');
  });

  it('R6: an extension upgrade that re-points its own master_detail onto ANOTHER parent lacking the code is refused, though the pointer reads the same', async () => {
    const viaInv2 = (reference: string) => ({
      inv2: { type: 'master_detail', label: 'Invoice 2', reference },
      ext_amount: follows('inv2.title'),
    });
    const { ql, manifest } = await bootWith([
      { ...ledger(), objects: [invoice(), object('suite_other')] },
      billing([line()]),
      extender(viaInv2('suite_invoice')),
    ]);

    const err = await refusal(() => manifest.register(extender(viaInv2('suite_other'), '1.0.1')));

    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'ext_amount' });
    expect(ql.registry.getPackage(EXTENDER)?.manifest?.version).toBe('1.0.0');
    expect(fieldOf(ql, 'suite_line', 'inv2')?.reference).toBe('suite_invoice');
  });
});

// ── [ADR-0144 D2] An extension's ONE-SEGMENT pointer, judged as its object is served, at the end of the run ──
//
// Pair (b) of the follow door: a record-mode amount an extension adds whose
// `currencyField` is a sibling name is judged against the served object. A run
// that adds a dangling one is refused; a run that leaves one as it found it
// (one a cold boot admitted unasked) is not (R7); a run that breaks one is
// refused naming the extension's package (R6).
describe('an extension\'s sibling record-currency pointer is judged against its object as served, at the end of the run', () => {
  /** The child, holding an ISO 4217 code of its own under `currency_code` (none when `withCode` is false). */
  const coded = (withCode = true) => object('suite_line', {
    fields: {
      title: { type: 'text', label: 'Title' },
      invoice: { type: 'master_detail', label: 'Invoice', reference: 'suite_invoice' },
      ...(withCode ? { currency_code: CODE } : {}),
    },
  });

  it('an extension-only install naming no field of the served object is refused 422, naming the candidates, and leaves nothing', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger('currency_code'));
    await manifest.register(billing([coded()]));

    const err = await refusal(() => manifest.register(extender({ ext_amount: follows('zz_missing') }), { source: 'marketplace' }));

    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'ext_amount' });
    expect(String(err?.message)).toContain("'zz_missing'");
    expect(String(err?.message)).toContain("candidates: 'currency_code'");
    expect(extraOf(ql)).toBeUndefined();
    expect(ql.registry.getPackage(EXTENDER)).toBeUndefined();
  });

  it('CONTROL: the extension naming the code field the owner declares installs', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger('currency_code'));
    await manifest.register(billing([coded()]));

    await manifest.register(extender({ ext_amount: follows('currency_code') }), { source: 'marketplace' });

    expect(extraOf(ql)?.currencyConfig?.currencyField).toBe('currency_code');
  });

  it('R7: a no-change upgrade of the owner, and of the extension, installs over a dangling pointer a cold boot admitted', async () => {
    const { ql, manifest } = await bootWith([ledger('currency_code'), billing([coded()]), extender({ ext_amount: follows('zz_missing') })]);
    expect(extraOf(ql)?.currencyConfig?.currencyField).toBe('zz_missing');

    await manifest.register(billing([coded()], '1.0.1'));
    await manifest.register(extender({ ext_amount: follows('zz_missing') }, '1.0.1'));

    expect(ql.registry.getPackage(BILLING)?.manifest?.version).toBe('1.0.1');
    expect(ql.registry.getPackage(EXTENDER)?.manifest?.version).toBe('1.0.1');
  });

  it('R6: an owner upgrade that removes the code field an extension\'s amount names is refused, naming the extension\'s package', async () => {
    const { ql, manifest } = await bootWith([ledger('currency_code'), billing([coded()]), extender({ ext_amount: follows('currency_code') })]);

    const err = await refusal(() => manifest.register(billing([coded(false)], '1.0.1')));

    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'ext_amount' });
    expect(String(err?.message)).toContain(`'${EXTENDER}'`);
    expect(ql.registry.getPackage(BILLING)?.manifest?.version).toBe('1.0.0');
  });
});
