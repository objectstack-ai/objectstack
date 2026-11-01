// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28409, ADR-0146 D8, the hard requirement ruled on #28238 (option 3)] The
 * anonymous form doors read the ONE effective list and still judge withdrawal
 * against a layer never narrower than the one they judged before.
 *
 * Since #28409 the environment's view list (`getMetaItems`) holds one item per
 * name a code package ships — that package's document, or its declared
 * `.custom` override — so a dependent package's same-named row no longer sits
 * beside the base's item there. That row may be the one that WITHDRAWS the
 * base's public form. The doors therefore judge every candidate against the
 * effective list beside the per-package layer
 * (`getMetaItemsPerPackage`), which still holds that row.
 *
 * Unlike `public-form-withdrawal.test.ts`, nothing here injects the list:
 * `resolveFormBySlug` reads the REAL protocol over a real `ObjectQL` engine
 * and a real SQL store, the base shipped through `registerApp`, the dependent
 * package installed through the package door and its row written through the
 * draft save and the per-item publish.
 *
 *  - a dependent package's row of the base's form view that withdraws the
 *    form (a row stored before #28410's write gate, which now refuses that
 *    save) closes it on both doors, although the effective list no longer
 *    holds that row (the pin the card names; its ablation reads only the
 *    effective list and re-opens the form);
 *  - CONTROL: with no withdrawing row the base's form is served;
 *  - the base's declared `.custom` override is the form served, and an
 *    override that withdraws the form closes it;
 *  - an override cannot re-open a form the base's own document withdraws:
 *    that document is a body the doors honour today (fails closed).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import {
  SysMetadataAuditObject,
  SysMetadataCommitObject,
  SysMetadataHistoryObject,
  SysMetadataObject,
} from '@objectstack/metadata-core';
import { RestServer } from './rest-server';

const BASE = 'com.example.forms28409';
const PAIR = `${BASE}.custom`;
const DEPENDENT = 'com.default.acme-forms28409';
const OBJECT = 'pfw_inquiry_28409';
const VIEW = `${OBJECT}.contact`;
const SLUG = 'contact-28409';

const sharing = (allowAnonymous: boolean) => ({ enabled: true, allowAnonymous, publicLink: `/forms/${SLUG}` });

const formView = (allowAnonymous: boolean, label = 'Contact us', extra: Record<string, unknown> = {}) => ({
  name: VIEW,
  object: OBJECT,
  viewKind: 'form',
  label,
  config: {
    type: 'simple',
    data: { provider: 'object', object: OBJECT },
    sections: [{ fields: ['name', 'email'] }],
    sharing: sharing(allowAnonymous),
  },
  ...extra,
});

const INQUIRY = {
  name: OBJECT,
  label: 'Inquiry',
  fields: {
    name: { name: 'name', type: 'text' as const, label: 'Name' },
    email: { name: 'email', type: 'text' as const, label: 'Email' },
  },
};

function mockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    header: () => res,
    end: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: unknown) => { res._json = body; return res; },
  };
  return res;
}

interface Answer { status: number; body: any }

async function boot(baseAllowsAnonymous = true) {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    engine.registry.registerObject(o as any, 'test-package');
  }
  engine.registerApp({
    id: BASE,
    name: 'forms28409',
    version: '1.0.0',
    objects: [INQUIRY],
    // A shipped view is a container; its `formViews.contact` slot expands to
    // the `<object>.contact` form view the doors read.
    views: [{
      object: OBJECT,
      formViews: {
        contact: {
          label: 'Contact us',
          type: 'simple',
          data: { provider: 'object', object: OBJECT },
          sections: [{ fields: ['name', 'email'] }],
          sharing: sharing(baseAllowsAnonymous),
        },
      },
    }],
  } as any);
  await engine.syncSchemas();
  const protocol: any = new ObjectStackProtocolImplementation(engine as any, () => new Map());
  const rest = new RestServer(mockServer() as any, protocol, { api: { requireAuth: false } } as any);
  rest.registerRoutes();
  const route = (method: string, path: string) => {
    const found = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    expect(found, `${method} ${path} is registered`).toBeDefined();
    return found!;
  };
  const resolve = route('GET', '/api/v1/forms/:slug');
  const submit = route('POST', '/api/v1/forms/:slug/submit');
  const get = async (): Promise<Answer> => {
    const res = makeRes();
    await resolve.handler({ params: { slug: SLUG }, query: {}, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  const post = async (): Promise<Answer> => {
    const res = makeRes();
    await submit.handler({ params: { slug: SLUG }, body: { name: 'Ada', email: 'ada@example.test' }, headers: {} } as any, res);
    return { status: res._status ?? 200, body: res._json };
  };
  const install = async (id: string) => protocol.installPackage({
    manifest: { id, name: id.split('.').join('-'), version: '0.1.0', type: 'app', dependencies: { [BASE]: '*' } },
  });
  const saveInto = async (packageId: string, item: Record<string, unknown>) => {
    await protocol.saveMetaItem({ type: 'view', name: VIEW, item, mode: 'draft', packageId });
    await protocol.publishMetaItem({ type: 'view', name: VIEW, packageId });
  };
  // [#28410, ADR-0146 D2, ruling A on #28390] A dependent package's row under
  // a name the base ships is refused at the save door now (rename is its one
  // fix), so the withdrawing row this file pins is one stored BEFORE that gate:
  // the door's refusal is asserted first, then the same body goes through the
  // same draft save and per-item publish with the gate's verdict held at
  // `not_concerned` for that one write, the row a pre-gate save left.
  const saveIntoBeforeTheGate = async (packageId: string, item: Record<string, unknown>) => {
    await expect(protocol.saveMetaItem({ type: 'view', name: VIEW, item, mode: 'draft', packageId }))
      .rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    protocol.overrideWriteVerdict = () => ({ verdict: 'not_concerned' });
    try {
      await saveInto(packageId, item);
    } finally {
      delete protocol.overrideWriteVerdict;
    }
  };
  return { engine, protocol, get, post, install, saveInto, saveIntoBeforeTheGate };
}

type Booted = Awaited<ReturnType<typeof boot>>;
const closed = (answer: Answer) => [answer.status, answer.body?.code];

describe('[#28409] the form doors judge withdrawal against the effective read, never a narrower list', () => {
  const engines: ObjectQL[] = [];
  const savedWritable = process.env.OS_METADATA_WRITABLE;
  beforeAll(() => {
    delete process.env.OS_METADATA_WRITABLE;
  });
  beforeEach(() => {
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
  });
  afterAll(async () => {
    if (savedWritable === undefined) delete process.env.OS_METADATA_WRITABLE;
    else process.env.OS_METADATA_WRITABLE = savedWritable;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
    for (const engine of engines) await engine.destroy().catch(() => {});
  });
  const booted = async (baseAllowsAnonymous = true): Promise<Booted> => {
    const b = await boot(baseAllowsAnonymous);
    engines.push(b.engine);
    return b;
  };

  it('CONTROL: the base\'s public form is served by the real list', async () => {
    const { protocol, get } = await booted();
    const shipped = ((await protocol.getMetaItems({ type: 'view' })).items as any[]).filter((v) => v?.name === VIEW);
    expect(shipped.map((v) => [v._packageId, v.config?.sharing?.allowAnonymous])).toEqual([[BASE, true]]);
    const answer = await get();
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
  });

  it('a dependent package\'s row that withdraws the base\'s form closes it on both doors, though the effective list no longer holds it', async () => {
    const { protocol, get, post, install, saveIntoBeforeTheGate } = await booted();
    await install(DEPENDENT);
    await saveIntoBeforeTheGate(DEPENDENT, formView(false));

    // The premise: the effective list serves the base's (public) document
    // alone under the name, and the withdrawing row is the dependent's own
    // item in the per-package layer.
    const effective = ((await protocol.getMetaItems({ type: 'view' })).items as any[]).filter((v) => v?.name === VIEW);
    expect(effective.map((v) => v.config?.sharing?.allowAnonymous)).toEqual([true]);
    const layer = ((await protocol.getMetaItemsPerPackage({ type: 'view' })).items as any[]).filter((v) => v?.name === VIEW);
    expect(layer.map((v) => v.config?.sharing?.allowAnonymous).sort()).toEqual([false, true]);

    expect(closed(await get())).toEqual([404, 'FORM_NOT_FOUND']);
    expect(closed(await post())).toEqual([404, 'FORM_NOT_FOUND']);
  });

  it('the base\'s declared `.custom` override is the form served; an override that withdraws the form closes it', async () => {
    const opened = await booted();
    await opened.install(PAIR);
    await opened.saveInto(PAIR, formView(true, 'Write to us', { overrides: { package: BASE, basedOn: '1.0.0' } }));
    const served = await opened.get();
    expect(served.status, JSON.stringify(served.body)).toBe(200);
    expect(JSON.stringify(served.body)).toContain('Write to us');

    const withdrawn = await booted();
    await withdrawn.install(PAIR);
    await withdrawn.saveInto(PAIR, formView(false, 'Contact us', { overrides: { package: BASE, basedOn: '1.0.0' } }));
    expect(closed(await withdrawn.get())).toEqual([404, 'FORM_NOT_FOUND']);
  });

  it('an override cannot re-open a form the base\'s own document withdraws (fails closed)', async () => {
    const { get, install, saveInto } = await booted(false);
    expect(closed(await get())).toEqual([404, 'FORM_NOT_FOUND']);
    await install(PAIR);
    await saveInto(PAIR, formView(true, 'Contact us', { overrides: { package: BASE, basedOn: '1.0.0' } }));
    expect(closed(await get())).toEqual([404, 'FORM_NOT_FOUND']);
  });
});
