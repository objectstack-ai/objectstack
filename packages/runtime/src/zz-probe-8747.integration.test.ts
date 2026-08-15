// TEMPORARY PROBE — #8747 measurement. Not for commit.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  SysMetadataObject,
  SysMetadataHistoryObject,
  SysMetadataAuditObject,
} from '@objectstack/metadata-core';

const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';
const NAME = 'shared_grid';

let cleanup: Array<() => void> = [];
afterEach(() => { for (const c of cleanup) c(); cleanup = []; });

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'os-8747-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
  const objects = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject] as any[];
  await driver.initObjects(objects);
  const engine = new ObjectQL();
  engine.registerDriver(driver as any, true);
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o, '@objectstack/platform-objects');
  cleanup.push(() => { void engine.destroy(); });
  const protocol = new ObjectStackProtocolImplementation(engine as any, undefined, undefined, 'package-author');
  return { engine, protocol };
}

const viewBody = (name: string) => ({
  name, label: name, type: 'grid', object: 'anything',
  viewKind: 'list', data: { provider: 'object', object: 'anything' }, columns: ['id'],
});

describe('#8747 probe', () => {
  it('MEASURE: what does auditMetaItem return when two orgs share (type, name)?', async () => {
    const { engine, protocol } = await boot();

    await (protocol as any).saveMetaItem({
      type: 'view', name: NAME, item: viewBody(NAME),
      organizationId: ORG_A, actor: 'alice@alpha.example', source: 'studio',
    });
    await (protocol as any).saveMetaItem({
      type: 'view', name: NAME, item: viewBody(NAME),
      organizationId: ORG_B, actor: 'bob@beta.example', source: 'studio',
    });
    await (protocol as any).saveMetaItem({
      type: 'view', name: NAME, item: viewBody(NAME),
      actor: 'package-installer', source: 'package',
    });

    const raw = (await engine.find('sys_metadata_audit', { where: {} })) as any[];
    // eslint-disable-next-line no-console
    console.log('RAW AUDIT ROWS:', raw.map((r) => `${r.type}/${r.name} org=${r.organization_id ?? 'ENV'} actor=${r.actor}`));

    const { events } = await (protocol as any).auditMetaItem({ type: 'view', name: NAME });
    // eslint-disable-next-line no-console
    console.log('auditMetaItem() ACTORS:', events.map((e: any) => e.actor));
    expect(events.length).toBe(-1); // force the print
  });

  it('MEASURE: does the engine thread tenantId into DriverOptions for a context-less find?', async () => {
    const seen: any[] = [];
    const engine = new ObjectQL();
    const stub: any = {
      name: 'probe', version: '0', supports: {},
      async connect() {}, async disconnect() {}, async checkHealth() { return true; },
      async find(_o: string, _ast: any, options: any) { seen.push(options); return []; },
      async findOne() { return null; },
      async create(_o: string, d: any) { return d; },
      async update(_o: string, _id: string, d: any) { return d; },
      async delete() { return true; },
      async count() { return 0; },
    };
    engine.registerDriver(stub, true);
    await engine.init();
    engine.registry.registerObject(SysMetadataAuditObject as any, '@objectstack/platform-objects');

    // (1) exactly how auditMetaItem calls it — no context at all
    await engine.find('sys_metadata_audit', { where: { type: 'view', name: NAME } } as any);
    // (2) positive control — a tenant-scoped caller
    await engine.find('sys_metadata_audit', {
      where: { type: 'view', name: NAME },
      context: { userId: 'u1', tenantId: ORG_A },
    } as any);

    // eslint-disable-next-line no-console
    console.log('DRIVEROPTIONS context-less:', JSON.stringify(seen[0] ?? null));
    // eslint-disable-next-line no-console
    console.log('DRIVEROPTIONS tenant-scoped:', JSON.stringify(seen[1] ?? null));
    expect(seen.length).toBe(-1); // force the print
  });
});
