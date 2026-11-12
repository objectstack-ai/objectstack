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

  it('a package upgraded under a tenant\'s overlay that holds the followed code installs: the overlay is what is served', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger());
    // The tenant's overlay of the packaged parent adds the code field, and a tenant's child follows it.
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

  it('an upgrade whose new child follows a code field the tenant\'s overlay does not hold is refused: the pair is judged against the served parent, as a single save judges it', async () => {
    const { ql, manifest } = await boot();
    await manifest.register(ledger());
    // The tenant customized the packaged parent before the package gave it a code field.
    ql.registry.registerObject({ ...invoice(), label: 'Customer invoice', _provenance: 'org' } as never, 'sys_metadata', undefined, 'overlay');

    const err = await refusal(() => manifest.register({
      ...ledger('currency_code'), version: '2.0.0',
      objects: [invoice('currency_code'), line('invoice.currency_code')],
    }));

    // The served parent is the overlay's body, which holds no `currency_code`:
    // every write of the amount would be refused for want of a code.
    expect(err).toMatchObject({ ...FOLLOW_REFUSED, objectName: 'suite_line', fieldName: 'amount' });
    expect(String(err?.message)).toContain("'suite_invoice' declares no field 'currency_code'");
    expect(ql.registry.getPackage(LEDGER)?.manifest?.version).toBe('1.0.0');
    expect(ql.registry.getObject('suite_line')).toBeUndefined();
    expect((ql.registry.getObject('suite_invoice') as any)?.label).toBe('Customer invoice');
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
