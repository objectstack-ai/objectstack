// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22360] `assertSystemRowWriteGate` on a PACKAGE-provided `sys_position` row:
// its definition is locked, its row state is not.
//
// The declared-position seeder stamps `managed_by: 'package'` on the row of a
// position a code package holds, so this gate now protects that row. A package
// position row is locked the way a packaged permission set is
// (`permission-set-projection.ts`, #4669): a patch touching ONLY row state
// (`active`, `is_default`) passes, because switching a package's position off,
// or making it the default for new users, is not an edit of its definition.
// Everything else stays refused with the gate's own code: a definition column
// (`name`, `label`, `description`, `delegatable`), any other column, a delete
// and the other lifecycle verbs. Platform (built-in) rows and `sys_capability`
// get no carve-out.
//
// Each case runs one write through the plugin's REAL middleware over a store
// double, so "admitted" means every gate after this one admitted it too.

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import type { PermissionSet } from '@objectstack/spec/security';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

type Row = Record<string, unknown>;

const POSITION_FIELDS = Object.fromEntries(
  ['id', 'name', 'label', 'description', 'active', 'is_default', 'delegatable', 'managed_by'].map((n) => [n, { name: n }]),
);
const SCHEMAS: Record<string, unknown> = {
  sys_position: { name: 'sys_position', fields: POSITION_FIELDS },
  sys_capability: { name: 'sys_capability', fields: POSITION_FIELDS },
};

/** Plain CRUD on both asset objects — no wildcard, no `modifyAllRecords`. */
const ADMIN_SET: PermissionSet = {
  name: 'admin_set',
  label: 'Admin Set',
  objects: {
    sys_position: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    sys_capability: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
} as unknown as PermissionSet;

const rows = (): Record<string, Row[]> => ({
  sys_position: [
    { id: 'pos_pkg_a', name: 'field_rep', label: 'Field Rep', managed_by: 'package', active: true },
    { id: 'pos_pkg_b', name: 'auditor', label: 'Auditor', managed_by: 'package', active: true },
    { id: 'pos_legacy', name: 'legacy_lead', label: 'Legacy Lead', managed_by: 'config', active: true },
    { id: 'pos_platform', name: 'everyone', label: 'Everyone', managed_by: 'platform', active: true },
    { id: 'pos_admin', name: 'regional_lead', label: 'Regional Lead', managed_by: 'admin', active: true },
  ],
  sys_capability: [
    { id: 'cap_pkg', name: 'pkg_cap', label: 'Package Capability', managed_by: 'package', active: true },
  ],
});

async function boot() {
  const store = rows();
  const matches = (row: Row, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    if (Array.isArray(where.$and) && !where.$and.every((w: any) => matches(row, w))) return false;
    if (Array.isArray(where.$or) && !where.$or.some((w: any) => matches(row, w))) return false;
    return Object.entries(where).every(([k, v]) => {
      if (k === '$and' || k === '$or') return true;
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
        return (v as any).$in.map(String).includes(String(row[k]));
      }
      return String(row[k]) === String(v);
    });
  };

  let middleware: any;
  const ql = {
    registerMiddleware: (mw: any) => {
      if (!middleware) middleware = mw;
    },
    getSchema: (object: string) => SCHEMAS[object],
    find: vi.fn(async (object: string, o: any = {}) => (store[object] ?? []).filter((r) => matches(r, o?.where))),
    findOne: vi.fn(async (object: string, o: any = {}) => {
      assertEngineFindOnePredicate(object, o);
      return (store[object] ?? []).find((r) => matches(r, o?.where)) ?? null;
    }),
  };
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: ql,
    metadata: { get: async (n: string) => SCHEMAS[n], list: async () => [ADMIN_SET] },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ defaultPermissionSets: [ADMIN_SET], fallbackPermissionSet: ADMIN_SET.name });
  await plugin.init(ctx);
  await plugin.start(ctx);

  /** One write through the real middleware: 'admitted', or the refusal's code + status + message. */
  const write = async (opCtx: Record<string, unknown>): Promise<'admitted' | { code: unknown; status: unknown; message: string }> => {
    let admitted = false;
    try {
      await middleware(
        { options: {}, context: { userId: 'usr_admin', tenantId: 'org-1', positions: [], permissions: [] }, ...opCtx } as any,
        async () => { admitted = true; },
      );
    } catch (e: any) {
      return { code: e?.code, status: e?.status ?? e?.statusCode, message: String(e?.message ?? '') };
    }
    if (!admitted) throw new Error('middleware resolved without calling next()');
    return 'admitted';
  };
  return { write };
}

const update = (object: string, data: unknown, where: Row = {}) => ({ object, operation: 'update', data, options: { where } });
const byId = (id: string, patch: Row) => update('sys_position', { id, ...patch }, { id });
const REFUSED = { code: 'PERMISSION_DENIED', status: 403 };

describe('[#22360] a package position row: row state switches, the definition stays locked', () => {
  it('a row-state-only patch passes: deactivate, activate, Set as Default, both together', async () => {
    const h = await boot();
    expect(await h.write(byId('pos_pkg_a', { active: false }))).toBe('admitted');
    expect(await h.write(byId('pos_pkg_a', { active: true }))).toBe('admitted');
    expect(await h.write(byId('pos_pkg_a', { is_default: true }))).toBe('admitted');
    expect(await h.write(byId('pos_pkg_a', { active: false, is_default: false }))).toBe('admitted');
    // The id carried only by the filter, as the engine's by-id update spells it.
    expect(await h.write(update('sys_position', { active: false }, { id: 'pos_pkg_a' }))).toBe('admitted');
  });

  it('a definition column, any other column, or a mixed patch is refused with the gate\'s code', async () => {
    const h = await boot();
    for (const patch of [
      { label: 'Field Rep (edited)' },
      { description: 'edited' },
      { delegatable: true },
      { name: 'field_rep_two' },
      { active: false, label: 'Field Rep (edited)' },
      { is_default: true, delegatable: true },
      { active: false, notes: 'not a row-state column' },
    ]) {
      const refused = await h.write(byId('pos_pkg_a', patch));
      expect(refused, JSON.stringify(patch)).toMatchObject(REFUSED);
      expect((refused as any).message).toContain('provided by an application package');
    }
  });

  it('an empty patch admits nothing new: it is refused as before', async () => {
    const h = await boot();
    expect(await h.write(byId('pos_pkg_a', {}))).toMatchObject(REFUSED);
  });

  it('delete and the other lifecycle verbs stay refused', async () => {
    const h = await boot();
    for (const operation of ['delete', 'transfer', 'restore', 'purge']) {
      const refused = await h.write({ object: 'sys_position', operation, options: { where: { id: 'pos_pkg_a' } } });
      expect(refused, operation).toMatchObject(REFUSED);
    }
  });

  it('the legacy `config` spelling of package provenance answers as its canonical twin', async () => {
    const h = await boot();
    expect(await h.write(byId('pos_legacy', { active: false }))).toBe('admitted');
    expect(await h.write(byId('pos_legacy', { label: 'edited' }))).toMatchObject(REFUSED);
  });

  it('control: a built-in\'s bare { active } patch stays refused', async () => {
    const h = await boot();
    const refused = await h.write(byId('pos_platform', { active: false }));
    expect(refused).toMatchObject(REFUSED);
    expect((refused as any).message).toContain('provided by the platform');
    expect(await h.write(byId('pos_platform', { is_default: true }))).toMatchObject(REFUSED);
  });

  it('control: sys_capability gets no carve-out', async () => {
    const h = await boot();
    expect(await h.write(update('sys_capability', { id: 'cap_pkg', active: false }, { id: 'cap_pkg' }))).toMatchObject(REFUSED);
  });

  it('control: an administrator-authored position stays fully editable', async () => {
    const h = await boot();
    expect(await h.write(byId('pos_admin', { label: 'Regional Lead (edited)', delegatable: true }))).toBe('admitted');
  });

  it('control: forging provenance in a row-state patch is still refused (a)', async () => {
    const h = await boot();
    const refused = await h.write(byId('pos_admin', { active: false, managed_by: 'package' }));
    expect(refused).toMatchObject(REFUSED);
    expect((refused as any).message).toContain('cannot stamp');
  });
});

describe('[#22360] a filtered update over package position rows', () => {
  const PKG_NAMES = { name: { $in: ['field_rep', 'auditor'] } };

  it('a row-state-only patch over package rows passes', async () => {
    const h = await boot();
    expect(await h.write(update('sys_position', { active: false }, PKG_NAMES))).toBe('admitted');
    expect(await h.write(update('sys_position', { is_default: false }, PKG_NAMES))).toBe('admitted');
  });

  it('a label patch over a package row is refused', async () => {
    const h = await boot();
    const refused = await h.write(update('sys_position', { label: 'Renamed' }, PKG_NAMES));
    expect(refused).toMatchObject(REFUSED);
    expect((refused as any).message).toContain('provided by the platform or an application package');
  });

  it('a row-state-only patch whose filter also reaches a built-in is refused', async () => {
    const h = await boot();
    expect(await h.write(update('sys_position', { active: false }, { name: { $in: ['field_rep', 'everyone'] } })))
      .toMatchObject(REFUSED);
    // A whole-table write matches every built-in.
    expect(await h.write({ object: 'sys_position', operation: 'update', data: { active: false }, options: {} }))
      .toMatchObject(REFUSED);
  });

  it('control: a filtered delete over package rows stays refused', async () => {
    const h = await boot();
    expect(await h.write({ object: 'sys_position', operation: 'delete', options: { where: PKG_NAMES } }))
      .toMatchObject(REFUSED);
  });
});
