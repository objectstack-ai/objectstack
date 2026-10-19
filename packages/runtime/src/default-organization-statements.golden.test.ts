// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MEASUREMENT SCAFFOLD — baseline reading, replaced by the golden.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/rest';
import { AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { AppPlugin } from './app-plugin.js';
import { DefaultDatasourcePlugin } from './default-datasource-plugin.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';

const BOOT_TIMEOUT = 180_000;
const ORIGIN = 'http://localhost:3000';
const API = '/api/v1';
const SYS = { isSystem: true };
const DEV_ADMIN = { email: 'admin@objectos.ai', password: 'admin123' };

const PIN_APP: any = {
  manifest: { id: 'com.pin.defaultorgmemo24523', name: 'Default organization memo pins', version: '1.0.0' },
  objects: [{ name: 'pin_note', label: 'Pin note', fields: { title: { type: 'text', label: 'Title' } } }],
  data: [{ object: 'pin_note', mode: 'upsert', externalId: 'title', records: [{ title: 'seeded note' }] }],
};

const rowsOf = (r: unknown): Array<Record<string, any>> =>
  Array.isArray(r) ? r : ((r as { records?: Array<Record<string, any>> })?.records ?? []);

let kernel: any;
let engine: any;
let app: any;
let token = '';
let recording: string[] | undefined;

async function request(path: string): Promise<{ status: number; sql: string[] }> {
  recording = [];
  const res = await app.request(`${ORIGIN}${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  await res.text();
  const sql = recording;
  recording = undefined;
  return { status: res.status, sql };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'development';
  kernel = new ObjectKernel();
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
  await kernel.use(new HonoServerPlugin({ port: 0 }));
  await kernel.use(new AppPlugin(PIN_APP));
  await kernel.use(new PlatformObjectsPlugin());
  await kernel.use(new AuthPlugin({ secret: 'default-org-memo-24523-secret' }));
  await kernel.use(new SecurityPlugin(appSecurityPluginOptions(PIN_APP)));
  await kernel.use(new SharingServicePlugin());
  await kernel.use(createRestApiPlugin({}));
  await kernel.use(createDispatcherPlugin({}));
  await kernel.bootstrap();
  engine = await kernel.getServiceAsync('objectql');
  const httpServer = await kernel.getServiceAsync('http-server');
  app = httpServer.getRawApp();
  const knex = (engine as any).getDriver('sys_user').knex;
  knex.on('query', (q: any) => { if (recording) recording.push(String(q?.sql ?? '')); });
  const signIn = await app.request(`${ORIGIN}${API}/auth/sign-in/email`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(DEV_ADMIN),
  });
  expect(signIn.status).toBe(200);
  token = ((await signIn.json()) as { token: string }).token;
}, BOOT_TIMEOUT);

afterAll(async () => {
  try { await kernel?.shutdown?.(); } catch { /* best-effort */ }
}, 60_000);

async function measure(label: string) {
  for (const path of ['/auth/get-session', '/data/pin_note?$top=1']) {
    const counts: number[] = [];
    let orgReads = 0;
    let last: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await request(path);
      expect(r.status).toBe(200);
      counts.push(r.sql.length);
      orgReads = r.sql.filter((s) => /sys_organization/.test(s)).length;
      last = r.sql;
    }
    // eslint-disable-next-line no-console
    console.log(`MEASURE ${label} ${path} counts=${counts.join(',')} warmOrgReads=${orgReads}\n  ${last.join('\n  ')}`);
  }
}

describe('baseline', () => {
  it('measures', async () => {
    const [grant] = rowsOf(await engine.find('sys_user_permission_set', { where: { permission_set: 'admin_full_access' }, limit: 5, context: SYS }));
    const [org] = rowsOf(await engine.find('sys_organization', { where: {}, limit: 5, context: SYS }));
    // eslint-disable-next-line no-console
    console.log('MEASURE grant', JSON.stringify(grant), 'org', JSON.stringify(org));
    await measure(`org-owned grant, slug=${org.slug}`);
    await engine.update('sys_organization', { id: org.id, slug: 'acme' }, { context: SYS });
    await measure('org-owned grant, slug=acme');
    await engine.update('sys_user_permission_set', { id: grant.id, organization_id: null }, { context: SYS });
    await measure('org-less grant, slug=acme');
    await engine.update('sys_organization', { id: org.id, slug: 'default' }, { context: SYS });
    await measure('org-less grant, slug=default');
  }, 120_000);
});
