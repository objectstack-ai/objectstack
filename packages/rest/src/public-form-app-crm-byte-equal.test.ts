// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0159 D5, card ② "Done when"] The public form of `examples/app-crm`
 * (`/forms/contact-us`, the lead container's `formViews.web_to_lead`) answers
 * at its address as it did before the `form` type, byte-equal on the resolve
 * door. The fixture `form-old-shape-before.json` (`crm-resolve`) was taken by
 * the same boot against the rename-only head `cb854ea4d`, which serves no
 * `form` type, and is never regenerated from this tree.
 *
 * It reads the example's own sources, so it runs in the `repo` project
 * (`vitest.repo-tests.json`), a separate file from the door harness
 * (`public-form-two-type-withdrawal.test.ts`) for that reason only.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';
import * as CRM_OBJECTS from '../../../examples/app-crm/src/objects/index';
import { LeadViews } from '../../../examples/app-crm/src/views/lead.view';

const BEFORE = JSON.parse(readFileSync(new URL('./form-old-shape-before.json', import.meta.url), 'utf8'));

function mockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}
function makeRes() {
  const res: any = {
    header: () => res, setHeader: () => res, end: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (b: unknown) => { res._json = b; return res; },
  };
  return res;
}

describe('[ADR-0159 D5] examples/app-crm: the public form answers byte-equal on the resolve door', () => {
  const engines: ObjectQL[] = [];
  afterAll(async () => {
    for (const engine of engines) await engine.destroy().catch(() => {});
  });

  it('GET /api/v1/forms/contact-us answers the fixture taken before the type, and the form is also read as a `form` item', async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    const engine = new ObjectQL();
    engines.push(engine);
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
      engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp({ id: 'com.example.crm', name: 'crm', version: '1.0.0', namespace: 'crm', objects: Object.values(CRM_OBJECTS), views: [LeadViews] } as any);
    await engine.syncSchemas();
    const protocol: any = new ObjectStackProtocolImplementation(engine as any, () => new Map());
    const rest = new RestServer(mockServer() as any, protocol, { api: { requireAuth: false } } as any);
    rest.registerRoutes();
    const resolve = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/forms/:slug')!;
    const res = makeRes();
    await resolve.handler({ params: { slug: 'contact-us' }, query: {}, headers: {} } as any, res);
    // Byte-equal: the answer as the wire serializes it, key order included.
    expect(JSON.stringify({ status: res._status ?? 200, body: res._json })).toBe(JSON.stringify(BEFORE['crm-resolve']));
    const forms = ((await protocol.getMetaItems({ type: 'form' })).items as any[]).filter((f) => f?.sharing?.publicLink === '/forms/contact-us');
    expect(forms.map((f) => [f.name, f._formDefinedIn])).toEqual([['crm_lead.web_to_lead', 'view']]);
  });
});
