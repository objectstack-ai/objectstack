// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#2909 P0/T1] sys_sharing_rule provenance + seed-not-clobber.
 *
 * sys_sharing_rule is record-authoritative (ADR-0094 addendum): declared
 * rules are a boot seed, the row is the authority. The seed (defineRule with
 * managedBy package/platform):
 *   - adopts pristine/legacy rows and keeps updating them (package upgrades
 *     stay deliverable),
 *   - NEVER overwrites a row the admin authored (managed_by admin) or
 *     customized — most importantly an admin's `active: false` on an
 *     over-sharing rule must survive redeploys (no resurrection),
 *   - non-seed defineRule keeps its historical clobber semantics.
 * The `customized` stamp is applied by a beforeUpdate hook on any
 * non-system edit of a package/platform row.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { bindRuleProvenanceStamp, SHARING_RULE_PROVENANCE_PACKAGE } from './sharing-rule-provenance.js';

interface Row { [k: string]: any }

const SYS = { isSystem: true } as any;

function makeEngine() {
  const tables: Record<string, Row[]> = {};
  const hooks: Array<{ event: string; handler: (ctx: any) => any; options: Row }> = [];
  const ensure = (n: string) => (tables[n] ??= []);
  function matches(row: Row, f: any): boolean {
    if (!f || typeof f !== 'object') return true;
    for (const [k, v] of Object.entries(f)) {
      if (row[k] !== v) return false;
    }
    return true;
  }
  return {
    _tables: tables,
    _hooks: hooks,
    getSchema() { return undefined; },
    async find(o: string, opts?: any) {
      const f = opts?.filter ?? opts?.where;
      return ensure(o).filter((r) => matches(r, f)).slice(0, opts?.limit ?? 10000);
    },
    async insert(o: string, data: any) { const row = { ...data }; ensure(o).push(row); return row; },
    async update(o: string, idOrData: any, dataOrOpts?: any) {
      const data = typeof idOrData === 'object' ? idOrData : dataOrOpts;
      const id = typeof idOrData === 'object' ? idOrData.id : idOrData;
      const t = ensure(o); const i = t.findIndex((r) => r.id === id);
      if (i >= 0) t[i] = { ...t[i], ...data };
      return t[i];
    },
    async delete(o: string, opts?: any) {
      const t = ensure(o); const where = opts?.where ?? {};
      for (let i = t.length - 1; i >= 0; i--) if (matches(t[i], where)) t.splice(i, 1);
      return { ok: true };
    },
    registerHook(event: string, handler: (ctx: any) => any, options: Row = {}) {
      hooks.push({ event, handler, options });
    },
    unregisterHooksByPackage(packageId: string) {
      let removed = 0;
      for (let i = hooks.length - 1; i >= 0; i--) {
        if (hooks[i].options.packageId === packageId) { hooks.splice(i, 1); removed++; }
      }
      return removed;
    },
    /** Test helper: simulate an engine update passing through beforeUpdate hooks. */
    async updateThroughHooks(o: string, id: string, data: Row, session: Row) {
      for (const h of hooks) {
        if (h.event === 'beforeUpdate' && h.options.object === o) {
          await h.handler({ session, input: { id, data } });
        }
      }
      return this.update(o, id, data);
    },
  };
}

const DECLARED = {
  name: 'red_projects_to_exec', label: 'Red projects → exec', object: 'showcase_project',
  criteria: { health: 'red' },
  recipientType: 'position' as const, recipientId: 'exec', accessLevel: 'read' as const,
  managedBy: 'package' as const,
};

describe('defineRule seed-not-clobber (#2909 P0/T1)', () => {
  let engine: ReturnType<typeof makeEngine>;
  let rules: SharingRuleService;

  beforeEach(() => {
    engine = makeEngine();
    const sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({ engine: engine as any, sharing });
  });

  it('seeds a new declared rule with managed_by:package and customized:false', async () => {
    const r = await rules.defineRule(DECLARED as any, SYS);
    expect(r.managed_by).toBe('package');
    expect(r.customized).toBe(false);
    expect(engine._tables.sys_sharing_rule[0]).toMatchObject({ managed_by: 'package', customized: false });
  });

  it('keeps updating a PRISTINE seeded rule on re-seed (package upgrades deliverable)', async () => {
    await rules.defineRule(DECLARED as any, SYS);
    const r = await rules.defineRule({ ...DECLARED, label: 'Red projects → exec v2', accessLevel: 'edit' } as any, SYS);
    expect(r.label).toBe('Red projects → exec v2');
    expect(r.access_level).toBe('edit');
    expect(engine._tables.sys_sharing_rule).toHaveLength(1);
  });

  it('ADOPTS a legacy row with no provenance (stamps managed_by on re-seed)', async () => {
    engine._tables.sys_sharing_rule = [{
      id: 'srule_legacy', name: DECLARED.name, label: 'old', object_name: 'showcase_project',
      criteria_json: null, recipient_type: 'position', recipient_id: 'exec',
      access_level: 'read', active: true,
    }];
    const r = await rules.defineRule(DECLARED as any, SYS);
    expect(r.managed_by).toBe('package');
    expect(engine._tables.sys_sharing_rule[0].managed_by).toBe('package');
  });

  it('does NOT resurrect an admin-deactivated seeded rule (customized survives redeploys)', async () => {
    await rules.defineRule(DECLARED as any, SYS);
    // Admin deactivates the over-sharing rule (stamp applied by the hook — here direct).
    const row = engine._tables.sys_sharing_rule[0];
    await engine.update('sys_sharing_rule', { id: row.id, active: false, customized: true });
    // Next boot re-seeds with active:true…
    const r = await rules.defineRule(DECLARED as any, SYS);
    expect(r.active).toBe(false);
    expect(engine._tables.sys_sharing_rule[0].active).toBe(false);
  });

  it('never touches an admin-authored rule that collides on name (admin row wins + warn)', async () => {
    const warn = vi.fn();
    const sharing = new SharingService({ engine: engine as any });
    const svc = new SharingRuleService({ engine: engine as any, sharing, logger: { warn } });
    await svc.defineRule({ ...DECLARED, managedBy: undefined, label: 'Admin authored' } as any, SYS);
    expect(engine._tables.sys_sharing_rule[0].managed_by).toBe('admin');
    const r = await svc.defineRule(DECLARED as any, SYS);
    expect(r.label).toBe('Admin authored');
    expect(engine._tables.sys_sharing_rule[0].label).toBe('Admin authored');
    expect(warn).toHaveBeenCalled();
  });

  it('non-seed defineRule keeps clobber semantics and stamps admin provenance on insert', async () => {
    const first = await rules.defineRule({ ...DECLARED, managedBy: undefined } as any, SYS);
    expect(first.managed_by).toBe('admin');
    const r = await rules.defineRule({ ...DECLARED, managedBy: undefined, label: 'edited' } as any, SYS);
    expect(r.label).toBe('edited');
    // Programmatic re-define does not touch provenance columns.
    expect(engine._tables.sys_sharing_rule[0].managed_by).toBe('admin');
  });
});

describe('provenance stamp hook (#2909 T1)', () => {
  let engine: ReturnType<typeof makeEngine>;
  let rules: SharingRuleService;

  beforeEach(async () => {
    engine = makeEngine();
    const sharing = new SharingService({ engine: engine as any });
    rules = new SharingRuleService({ engine: engine as any, sharing });
    await rules.defineRule(DECLARED as any, SYS);
    bindRuleProvenanceStamp(engine as any);
  });

  it('stamps customized:true when a non-system caller edits a package rule', async () => {
    const row = engine._tables.sys_sharing_rule[0];
    await engine.updateThroughHooks('sys_sharing_rule', row.id, { active: false }, { userId: 'admin1' });
    expect(engine._tables.sys_sharing_rule[0]).toMatchObject({ active: false, customized: true });
  });

  it('does NOT stamp on isSystem writes (seeder/backfill are not customizations)', async () => {
    const row = engine._tables.sys_sharing_rule[0];
    await engine.updateThroughHooks('sys_sharing_rule', row.id, { label: 'reseed' }, { isSystem: true });
    expect(engine._tables.sys_sharing_rule[0].customized).toBe(false);
  });

  it('does NOT stamp admin-authored rows (an env row IS the definition)', async () => {
    await rules.defineRule({ ...DECLARED, name: 'admin_rule', managedBy: undefined } as any, SYS);
    const adminRow = engine._tables.sys_sharing_rule.find((r) => r.name === 'admin_rule')!;
    await engine.updateThroughHooks('sys_sharing_rule', adminRow.id, { active: false }, { userId: 'admin1' });
    expect(engine._tables.sys_sharing_rule.find((r) => r.name === 'admin_rule')!.customized).toBe(false);
  });

  it('ignores multi-row updates (no id) without crashing', async () => {
    const hook = engine._hooks.find((h) => h.options.packageId === SHARING_RULE_PROVENANCE_PACKAGE)!;
    await expect(hook.handler({ session: { userId: 'admin1' }, input: { data: { active: false } } })).resolves.toBeUndefined();
  });

  it('end-to-end: admin edit through hooks → next seed does not clobber', async () => {
    const row = engine._tables.sys_sharing_rule[0];
    await engine.updateThroughHooks('sys_sharing_rule', row.id, { active: false }, { userId: 'admin1' });
    const r = await rules.defineRule(DECLARED as any, SYS);
    expect(r.active).toBe(false);
  });
});
