// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0029 D9.2a, 2026-10-30 note (ruling of record 6524229156, letter C′) —
 * a validation rule's identity within an object is its `name`, and the
 * registry fold merges `validations` BY NAME across layers instead of
 * concatenating them.
 *
 * Measured before the note: a tenant overlay (the Studio GET → edit → PUT of
 * the folded object) that rewords an extension's rule held a copy of it, the
 * fold appended the extension's original beside the copy, and both ran — a
 * refused write reported the rule twice, once in each sentence.
 *
 * What the note binds, one block each below:
 *  1. a reworded copy merges with the packaged rule into ONE rule, carrying
 *     the tenant's `message`; its condition is the package's, so a package fix
 *     to the rule reaches the tenant;
 *  2. a copy that changes the condition or the `type` is refused with the
 *     ruling's prescription — and the fold never runs it;
 *  3. `active: false` on the copy deactivates the rule;
 *  4. rules of different names stay additive;
 *  5. the fold stays idempotent over a folded base (#8027) with nothing
 *     subtracted first, and a stored row from before the note collapses.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SchemaRegistry } from './registry.js';
import { ObjectQL } from './index.js';

const OBJ = 'vr_duty';
const OWNER_PKG = 'com.objectstack.test.vr-owner';
const EXT_PKG = 'com.objectstack.test.vr-extension';

const BLOCKED = "record.status == 'blocked' && record.note == null";
const DONE = "record.status == 'done' && record.owner == null";

const extRule = (overrides: Record<string, unknown> = {}) => ({
  type: 'script',
  name: 'ext_blocked_needs_reason',
  message: 'Say what is blocking the duty.',
  condition: BLOCKED,
  fields: ['note'],
  ...overrides,
});
const ownerRule = (overrides: Record<string, unknown> = {}) => ({
  type: 'script',
  name: 'done_needs_owner',
  message: 'A finished duty needs an owner.',
  condition: DONE,
  fields: ['owner'],
  ...overrides,
});

const fields = {
  status: { type: 'text', label: 'Status' },
  note: { type: 'text', label: 'Note' },
  owner: { type: 'text', label: 'Owner' },
};
const ownerBody = (rules: unknown[] = [ownerRule()]) => ({ name: OBJ, label: 'Duty', fields, validations: rules });
const extension = (rules: unknown[] = [extRule()]) => ({ name: OBJ, validations: rules });
/** The tenant's overlay: the object as Studio served it, with its rules as the tenant saved them. */
const overlay = (rules: unknown[]) => ({ name: OBJ, label: 'Duty', fields, validations: rules, _provenance: 'org' });

function registryWith(overlayRules?: unknown[], opts: { owner?: unknown[]; ext?: unknown[] } = {}) {
  const registry = new SchemaRegistry();
  registry.registerObject(ownerBody(opts.owner) as any, OWNER_PKG);
  registry.registerObject(extension(opts.ext) as any, EXT_PKG, undefined, 'extend');
  if (overlayRules) registry.registerObject(overlay(overlayRules) as any, OWNER_PKG, undefined, 'overlay');
  return registry;
}

const servedRules = (registry: SchemaRegistry) =>
  ((registry.getObject(OBJ) as any).validations as any[]).map((r) => ({
    name: r.name, message: r.message, condition: r.condition, ...(r.active === undefined ? {} : { active: r.active }),
  }));

function makeDriver() {
  const rows = new Map<string, any>();
  return {
    name: 'com.objectstack.driver.memory.vr',
    version: '1.0.0',
    async connect() { /* noop */ },
    async disconnect() { /* noop */ },
    async initObjects() { /* noop */ },
    async find() { return [...rows.values()]; },
    async findOne(_o: string, options?: any) { return rows.get(String(options?.where?.id)) ?? null; },
    async count() { return rows.size; },
    async create(_o: string, data: any) { rows.set(String(data.id), data); return data; },
    async update(_o: string, data: any) { return data; },
    async delete() { return false; },
  } as any;
}

/** Boot an engine with the three layers and answer every sentence a write is refused with (`[]` when admitted). */
async function refusalsOf(overlayRules: unknown[], record: Record<string, unknown>): Promise<string[]> {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(), true);
  await engine.init();
  try {
    engine.registry.registerObject(ownerBody() as any, OWNER_PKG);
    engine.registry.registerObject(extension() as any, EXT_PKG, undefined, 'extend');
    engine.registry.registerObject(overlay(overlayRules) as any, OWNER_PKG, undefined, 'overlay');
    try {
      await engine.insert(OBJ, record);
      return [];
    } catch (e: any) {
      const fieldErrors: Array<{ message?: unknown }> = Array.isArray(e?.fields) ? e.fields : [];
      return fieldErrors.length > 0 ? fieldErrors.map((f) => String(f.message)) : [String(e?.message)];
    }
  } finally {
    await engine.destroy();
  }
}

afterEach(() => { vi.restoreAllMocks(); });

describe('ADR-0029 D9.2a note — validation rules merge by name', () => {
  describe('1. a reworded copy is one rule, with the tenant\'s sentence', () => {
    const REWORD = 'Tell us what blocks this duty.';

    it('a reworded copy of an extension rule folds to ONE rule carrying the tenant\'s message', () => {
      const registry = registryWith([ownerRule(), extRule({ message: REWORD })]);
      expect(servedRules(registry)).toEqual([
        { name: 'done_needs_owner', message: 'A finished duty needs an owner.', condition: DONE },
        { name: 'ext_blocked_needs_reason', message: REWORD, condition: BLOCKED },
      ]);
    });

    it('a refused write reports the rule once, in the tenant\'s sentence', async () => {
      expect(await refusalsOf([ownerRule(), extRule({ message: REWORD })], { id: 'r1', status: 'blocked' }))
        .toEqual([REWORD]);
    });

    it('a reworded copy of an OWNER rule takes the owner\'s condition, so a package fix reaches the tenant', () => {
      const FIXED = "record.status == 'done' && (record.owner == null || record.owner == '')";
      const registry = registryWith(
        [ownerRule({ message: 'Name who owns this before closing it.' }), extRule()],
        { owner: [ownerRule({ condition: FIXED })] },
      );
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      expect(servedRules(registry)[0]).toEqual({
        name: 'done_needs_owner', message: 'Name who owns this before closing it.', condition: FIXED,
      });
    });

    it('two code layers declaring one name are one rule too: the later layer\'s, as a field is', () => {
      const registry = registryWith(undefined, { ext: [extRule(), ownerRule({ message: 'Extension says.' })] });
      expect(servedRules(registry).map((r) => [r.name, r.message])).toEqual([
        ['ext_blocked_needs_reason', 'Say what is blocking the duty.'],
        ['done_needs_owner', 'Extension says.'],
      ]);
      expect(((registry.getPackagedObjectBase(OBJ) as any).validations as any[]).map((r) => r.name))
        .toEqual(['ext_blocked_needs_reason', 'done_needs_owner']);
    });

    it('a copy whose parse stamped the schema defaults changes nothing the package owns', () => {
      const stamped = extRule({ message: REWORD, events: ['insert', 'update'], priority: 100, severity: 'error', active: true });
      const registry = registryWith([ownerRule(), stamped]);
      expect(registry.tenantRuleCopyRefusal(OBJ, overlay([ownerRule(), stamped]))).toBeNull();
    });
  });

  describe('2. a changed condition or type is refused, and never runs', () => {
    it('a copy that changes the condition is refused, with the ruling\'s prescription', () => {
      const registry = registryWith();
      const refusal = registry.tenantRuleCopyRefusal(
        OBJ, overlay([extRule({ condition: "record.status == 'blocked'" })]),
      ) as any;
      expect(refusal).toMatchObject({
        name: 'ValidationRuleCopyRefusedError',
        code: 'INVALID_METADATA',
        status: 422,
        objectName: OBJ,
        ruleName: 'ext_blocked_needs_reason',
        changedKeys: ['condition'],
      });
      expect(refusal.message).toContain(
        'To change the condition, add a rule under a new name, or change it in the package.',
      );
    });

    it('a copy that changes the type is refused, `type` named first', () => {
      const registry = registryWith();
      const refusal = registry.tenantRuleCopyRefusal(
        OBJ, overlay([ownerRule({ type: 'cross_field' })]),
      ) as any;
      expect(refusal).toMatchObject({
        name: 'ValidationRuleCopyRefusedError', ruleName: 'done_needs_owner', changedKeys: ['type'],
      });
      expect(refusal.message).toContain('`type`');
    });

    it('a stored copy with a changed condition is never run beside the package\'s rule, and is reported once', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const LOOSE = "record.status == 'never'";
      const registry = registryWith([ownerRule(), extRule({ condition: LOOSE })]);
      registry.getObject(OBJ);
      registry.invalidate(OBJ);
      registry.getObject(OBJ);
      expect(servedRules(registry)).toEqual([
        { name: 'done_needs_owner', message: 'A finished duty needs an owner.', condition: DONE },
        { name: 'ext_blocked_needs_reason', message: 'Say what is blocking the duty.', condition: BLOCKED },
      ]);
      const reports = errors.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('validation_rule_copy_changed'));
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain('"ext_blocked_needs_reason"');
      expect(reports[0]).toContain('To change the condition, add a rule under a new name, or change it in the package.');
      expect(await refusalsOf([ownerRule(), extRule({ condition: LOOSE })], { id: 'r2', status: 'blocked' }))
        .toEqual(['Say what is blocking the duty.']);
    });
  });

  describe('3. `active: false` deactivates', () => {
    it('the copy\'s switch is the rule\'s, and a write the rule would refuse is admitted', async () => {
      const registry = registryWith([ownerRule(), extRule({ active: false })]);
      expect(servedRules(registry)[1]).toEqual({
        name: 'ext_blocked_needs_reason', message: 'Say what is blocking the duty.', condition: BLOCKED, active: false,
      });
      expect(registry.tenantRuleCopyRefusal(OBJ, overlay([extRule({ active: false })]))).toBeNull();
      expect(await refusalsOf([ownerRule(), extRule({ active: false })], { id: 'r3', status: 'blocked' })).toEqual([]);
    });
  });

  describe('4. different names stay additive', () => {
    it('the tenant\'s own rule and the extension\'s rule both stand, and both run', async () => {
      const own = { type: 'script', name: 'tenant_note_short', message: 'Keep the note short.', condition: "record.note != null && size(record.note) > 5", fields: ['note'] };
      const registry = registryWith([ownerRule(), own]);
      expect(servedRules(registry).map((r) => r.name))
        .toEqual(['done_needs_owner', 'tenant_note_short', 'ext_blocked_needs_reason']);
      expect(registry.tenantRuleCopyRefusal(OBJ, overlay([own]))).toBeNull();
      expect(await refusalsOf([ownerRule(), own], { id: 'r4', status: 'blocked' }))
        .toEqual(['Say what is blocking the duty.']);
      expect(await refusalsOf([ownerRule(), own], { id: 'r5', status: 'open', note: 'far too long' }))
        .toEqual(['Keep the note short.']);
    });
  });

  describe('5. the fold over a folded base, with nothing subtracted first', () => {
    it('re-folding the served object gives the served object\'s rules back', () => {
      const registry = registryWith([ownerRule(), extRule({ message: 'Tell us what blocks this duty.' })]);
      const served = registry.getObject(OBJ) as any;
      const refolded = registry.foldObjectExtendersOnto(OBJ, served) as any;
      expect(refolded.validations).toEqual(served.validations);
    });

    it('a row stored while the fold still appended (the copy, then the original) folds to one rule, the tenant\'s sentence', () => {
      const registry = registryWith();
      const legacyRow = overlay([ownerRule(), extRule({ message: 'Tell us what blocks this duty.' }), extRule()]);
      const folded = registry.foldObjectExtendersOnto(OBJ, legacyRow) as any;
      expect(folded.validations.map((r: any) => [r.name, r.message])).toEqual([
        ['done_needs_owner', 'A finished duty needs an owner.'],
        ['ext_blocked_needs_reason', 'Tell us what blocks this duty.'],
      ]);
    });

    it('removing the extender removes its rule by name from the code layer', () => {
      const registry = registryWith();
      expect(servedRules(registry).map((r) => r.name)).toEqual(['done_needs_owner', 'ext_blocked_needs_reason']);
      registry.unregisterObjectsByPackage(EXT_PKG);
      expect(servedRules(registry).map((r) => r.name)).toEqual(['done_needs_owner']);
    });
  });
});
