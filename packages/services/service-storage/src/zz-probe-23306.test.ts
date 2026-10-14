// TEMPORARY measurement probe for #23306 — never committed.
import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { installAuditWriters } from '@objectstack/plugin-audit';
import { SystemFile } from './objects/system-file.object.js';
import { SysAttachment } from '@objectstack/platform-objects/audit';
import { installAttachmentLifecycleHooks } from './attachment-lifecycle.js';
import { installAttachmentAccessHooks } from './attachment-access-hooks.js';

function logger() {
  const l: any = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), trace: vi.fn(), fatal: vi.fn() };
  l.child = () => l;
  return l;
}

describe('probe', () => {
  it('measures', async () => {
    const ql = new ObjectQL({ logger: logger() } as any);
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any;
    ql.registerDriver(driver, true);
    await ql.init();
    ql.registry.registerObject(SystemFile as any, 'probe');
    ql.registry.registerObject(SysAttachment as any, 'probe');
    ql.registry.registerObject({ name: 'p_on', enable: { files: true }, fields: { name: { type: 'text' } } } as any, 'probe');
    ql.registry.registerObject({ name: 'p_off', fields: { name: { type: 'text' } } } as any, 'probe');
    await ql.syncSchemas();
    const lg = logger();
    installAttachmentLifecycleHooks(ql as any, lg);
    const checkEdit = vi.fn(async () => 'deny');
    installAttachmentAccessHooks(ql as any, () => ({ checkEdit }) as any, lg);
    installAuditWriters(ql as any, 'com.objectstack.audit', {});

    const SYS = { context: { isSystem: true } };
    await ql.insert('p_on', { id: 'a1', name: 'x', organization_id: 'org_a' }, SYS);
    await ql.insert('p_off', { id: 'b1', name: 'x', organization_id: 'org_a' }, SYS);
    const p = await ql.findOne('p_on', { where: { id: 'a1' } }, SYS as any);
    console.log('PARENT', JSON.stringify(p));
    console.log('SCHEMA fields', Object.keys((ql as any).getSchema?.('p_on')?.fields ?? {}));
    // scoped read under system + tenantId
    const scoped = await ql.findOne('p_on', { where: { id: 'a1' } }, { context: { isSystem: true, tenantId: 'org_b' } } as any);
    console.log('SCOPED org_b', JSON.stringify(scoped));

    // 1. files disabled under system
    try {
      await ql.insert('sys_attachment', { parent_object: 'p_off', parent_id: 'b1', file_id: 'f1' }, { context: { isSystem: true, tenantId: 'org_a' } } as any);
      console.log('FILES_OFF: admitted');
    } catch (e: any) {
      console.log('FILES_OFF:', e?.code, e?.status, e?.message);
    }
    // access hooks under system — checkEdit called?
    const r = await ql.insert('sys_attachment', { parent_object: 'p_on', parent_id: 'a1', file_id: 'f1', file_name: 'x' }, { context: { isSystem: true, tenantId: 'org_a' } } as any);
    console.log('ON: admitted', JSON.stringify(r), 'checkEdit calls', checkEdit.mock.calls.length);
    // unknown object read
    try {
      const x = await ql.findOne('nope_obj', { where: { id: 'z' } }, SYS as any);
      console.log('UNKNOWN read ->', x);
    } catch (e: any) {
      console.log('UNKNOWN read throws', e?.name, e?.code, e?.status, e?.message);
    }
    // transaction
    const info: any[] = [];
    try {
      await (ql as any).transaction(async (trx: any, i: any) => {
        info.push(i);
        await ql.insert('sys_file', { id: 'tf', key: 'k', name: 'n', status: 'pending' }, { context: { ...trx } } as any);
        await ql.insert('sys_attachment', { parent_object: 'p_off', parent_id: 'b1', file_id: 'tf' }, { context: { ...trx } } as any);
      }, { isSystem: true, tenantId: 'org_a' });
    } catch (e: any) {
      console.log('TX threw', e?.code);
    }
    console.log('TX info', JSON.stringify(info), 'tf after rollback', JSON.stringify(await ql.findOne('sys_file', { where: { id: 'tf' } }, SYS as any)));
    // sys_file without tenant under system
    try {
      await ql.insert('sys_file', { id: 'nf', key: 'k2', name: 'n', status: 'pending' }, SYS as any);
      console.log('SYSFILE no-tenant admitted', JSON.stringify(await ql.findOne('sys_file', { where: { id: 'nf' } }, SYS as any)));
    } catch (e: any) {
      console.log('SYSFILE no-tenant throws', e?.name, e?.code, e?.message?.slice(0, 200));
    }
    expect(true).toBe(true);
    await ql.destroy();
  });
});
