// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35609] A package registered again serves exactly the extensions its
 * current manifest declares.
 *
 * ## What was wrong
 *
 * The extend branch of object registration replaces a package's previous
 * contribution to a target only when the new registration names that same
 * target. A body registered again without an `objectExtensions` entry it used
 * to carry left the old extension registered, so its fields, validations and
 * indexes stayed on the served object until a restart. The real doors that
 * re-register a package without uninstalling it first: the `os dev` artifact
 * reload (`metadata:reloaded` → `ObjectQLPlugin` re-registering each installed
 * body) and the marketplace install-local door's upgrade or re-install
 * (`manifest.register`, pinned in `@objectstack/cloud-connection`).
 *
 * ## What these pin
 *
 *  - re-registering without the extension withdraws it: the fields, the
 *    validation and the index it added are no longer served, and the target's
 *    owner layer is untouched;
 *  - CONTROL (already right): re-registering with a renamed field serves the
 *    new field and not the old one;
 *  - another package's extension of the same target is untouched;
 *  - the same body registered again keeps its extension;
 *  - an extension registered under the package id outside a body (the
 *    `object_extension` item door's layer) is not the body's and is kept;
 *  - a refusal later in the same registration run puts the withdrawn
 *    extension back;
 *  - the reload door: an artifact reload whose module no longer extends the
 *    base's object withdraws the extension.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';

type ManifestService = { register(artifact: unknown, options?: { source?: 'code' | 'marketplace' }): Promise<void> };

const CORE = 'com.t.core';
const MOD = 'com.t.mod';
const OTHER = 'com.t.other';

const text = (label: string) => ({ type: 'text', label });

const core = () => ({
  id: CORE,
  name: 'core',
  version: '1.0.0',
  type: 'app',
  namespace: 'crm',
  objects: [{ name: 'crm_line', label: 'Line', fields: { name: { name: 'name', type: 'text', label: 'Name' } } }],
});

/** The module at `version`, extending `crm_line` with `extension` (none when `undefined`). */
const mod = (version: string, extension?: Record<string, unknown>) => ({
  id: MOD,
  name: 'mod',
  version,
  type: 'module',
  dependencies: { [CORE]: '^1.0.0' },
  objectExtensions: extension === undefined ? [] : [{ extend: 'crm_line', ...extension }],
});

const ACCOUNT_EXTENSION = {
  fields: { cb_account: { name: 'cb_account', type: 'text', label: 'A' } },
  validations: [{ name: 'cb_account_required', type: 'script', condition: 'record.cb_account == null', message: 'Account is required' }],
  indexes: [{ name: 'crm_line_cb_account', fields: ['cb_account'] }],
};

/** The served `crm_line`, as every read of it sees it. */
function served(ql: ObjectQL) {
  const line = ql.registry.getObject('crm_line') as any;
  return {
    fields: Object.keys(line?.fields ?? {}).filter((f) => f === 'name' || f.startsWith('cb_')).sort(),
    validations: (line?.validations ?? []).map((v: any) => v.name).filter((n: string) => n.startsWith('cb_')),
    indexes: (line?.indexes ?? []).map((i: any) => i.name).filter((n: string) => n.startsWith('crm_line_cb_')),
    layers: ql.registry.getObjectContributors('crm_line').map((c) => `${c.packageId}:${c.ownership}`),
  };
}

function bare(): ObjectQL {
  const ql = new ObjectQL();
  ql.registry.logLevel = 'silent';
  ql.registerApp(core() as any);
  ql.registerApp(mod('1.0.0', ACCOUNT_EXTENSION) as any);
  return ql;
}

describe('[#35609] a re-registered package serves exactly the extensions its current manifest declares', () => {
  it('re-registering without the extension withdraws its fields, validation and index; the owner stays', () => {
    const ql = bare();
    expect(served(ql)).toEqual({
      fields: ['cb_account', 'name'],
      validations: ['cb_account_required'],
      indexes: ['crm_line_cb_account'],
      layers: [`${CORE}:own`, `${MOD}:extend`],
    });

    ql.registerApp(mod('1.0.1') as any);

    expect(served(ql)).toEqual({ fields: ['name'], validations: [], indexes: [], layers: [`${CORE}:own`] });
    expect(ql.registry.getObjectExtensionsOf(MOD)).toEqual([]);
  });

  it('CONTROL: re-registering with a renamed field serves the new field and not the old one', () => {
    const ql = bare();
    ql.registerApp(mod('1.0.1', { fields: { cb_account2: { name: 'cb_account2', type: 'text', label: 'A2' } } }) as any);
    expect(served(ql)).toMatchObject({ fields: ['cb_account2', 'name'], layers: [`${CORE}:own`, `${MOD}:extend`] });
  });

  it('another package\'s extension of the same target is untouched', () => {
    const ql = bare();
    ql.registerApp({ id: OTHER, name: 'other', version: '1.0.0', type: 'module', objectExtensions: [{ extend: 'crm_line', fields: { cb_other: text('Other') } }] } as any);

    ql.registerApp(mod('1.0.1') as any);

    expect(served(ql)).toMatchObject({ fields: ['cb_other', 'name'], layers: [`${CORE}:own`, `${OTHER}:extend`] });
  });

  it('the same body registered again keeps its extension', () => {
    const ql = bare();
    const before = served(ql);
    ql.registerApp(mod('1.0.0', ACCOUNT_EXTENSION) as any);
    expect(served(ql)).toEqual(before);
  });

  it('an extension registered under the package id outside a body is not the body\'s, and is kept', () => {
    const ql = new ObjectQL();
    ql.registry.logLevel = 'silent';
    ql.registerApp(core() as any);
    ql.registerApp({ ...core(), id: OTHER, name: 'other', namespace: 'oth', objects: [{ name: 'oth_thing', label: 'Thing', fields: { name: text('Name') } }] } as any);
    ql.registerApp(mod('1.0.0', ACCOUNT_EXTENSION) as any);
    // The `object_extension` item door's layer: registered under MOD's id by no body.
    ql.registry.registerObject({ name: 'oth_thing', fields: { cb_side: text('Side') } } as any, MOD, undefined, 'extend');

    ql.registerApp(mod('1.0.1') as any);

    expect(served(ql).fields).toEqual(['name']);
    expect(Object.keys((ql.registry.getObject('oth_thing') as any).fields)).toContain('cb_side');
  });

  it('a refusal later in the same registration run puts the withdrawn extension back', () => {
    const ql = bare();
    const before = served(ql);
    let refusal: any;
    try {
      ql.registry.restoringOnRefusal(() => {
        ql.registerApp(mod('1.0.1') as any);
        expect(served(ql).fields).toEqual(['name']);
        throw Object.assign(new Error('a later member of the artifact is refused'), { code: 'INVALID_METADATA', status: 422 });
      });
    } catch (e) {
      refusal = e;
    }
    expect(refusal).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
    expect(served(ql)).toEqual(before);
    // …and the record of what the body shipped is put back too: the next
    // re-registration without the extension still withdraws it.
    ql.registerApp(mod('1.0.1') as any);
    expect(served(ql).fields).toEqual(['name']);
  });
});

// ── the reload door (`os dev`): `metadata:reloaded` re-registers each installed body ──

const kernels: ObjectKernel[] = [];
afterEach(async () => {
  while (kernels.length) {
    const kernel = kernels.pop()!;
    if (kernel.getState() === 'running') await kernel.shutdown();
  }
});

const artifact = (members: unknown[]) => ({ id: 'com.t.suite', version: '1.0.0', packages: members.map((manifest) => ({ manifest })) });

/** A kernel whose cold boot registers `atBoot` through the `manifest` service, and the reload announce. */
async function bootWith(atBoot: unknown) {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false } as never);
  kernels.push(kernel);
  let trigger: ((name: string, payload: unknown) => Promise<void>) | undefined;
  await kernel.use(new ObjectQLPlugin());
  await kernel.use({
    name: 'test.35609.boot',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    init: async () => {},
    start: async (ctx: { getService<T>(name: string): T; trigger: (name: string, payload: unknown) => Promise<void> }) => {
      trigger = (name, payload) => ctx.trigger(name, payload);
      await ctx.getService<ManifestService>('manifest').register(atBoot);
    },
  } as never);
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  ql.registry.logLevel = 'silent';
  return { ql, reload: (m: unknown) => trigger!('metadata:reloaded', { metadata: m }) };
}

describe('[#35609] the artifact reload door withdraws an extension the reloaded module no longer declares', () => {
  it('a reload whose module drops its extension of the base\'s object serves the object without its fields', async () => {
    const { ql, reload } = await bootWith(artifact([core(), mod('1.0.0', ACCOUNT_EXTENSION)]));
    expect(served(ql).fields).toEqual(['cb_account', 'name']);

    await reload(artifact([core(), mod('1.0.0')]));

    expect(served(ql)).toEqual({ fields: ['name'], validations: [], indexes: [], layers: [`${CORE}:own`] });
  });

  it('CONTROL: a reload that keeps the extension keeps its fields', async () => {
    const { ql, reload } = await bootWith(artifact([core(), mod('1.0.0', ACCOUNT_EXTENSION)]));
    await reload(artifact([core(), mod('1.0.0', ACCOUNT_EXTENSION)]));
    expect(served(ql).fields).toEqual(['cb_account', 'name']);
  });
});
