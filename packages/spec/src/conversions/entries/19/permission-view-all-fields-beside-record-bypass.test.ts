// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `permission-view-all-fields-beside-record-bypass` (protocol 19) — the DEFAULT
 * FLIP that carries a View All / Modify All set across the field-axis split.
 *
 * The fixture pair (conversions.test.ts) pins the rewrite; this file pins the
 * PREDICATE's edges and its JURISDICTION: the step-19 chain replays it, the
 * authoring funnel does not, a stored row never takes it (ruling of record
 * 7177446075, option A), and a second replay is a no-op. The artifact door's
 * refusal by id is pinned where that door lives (`@objectstack/metadata-core`).
 */

import { describe, expect, it } from 'vitest';

import { applyConversions } from '../../apply.js';
import { ALL_CONVERSIONS, CONVERSIONS_BY_MAJOR } from '../../registry.js';
import { applyConversionsToStoredItem } from '../../stored.js';
import type { ConversionNotice } from '../../types.js';
import { applyMetaMigrations } from '../../../migrations/chain.js';
import { MIGRATIONS_BY_MAJOR } from '../../../migrations/registry.js';
import { normalizeStackInput } from '../../../shared/metadata-collection.zod.js';

const ID = 'permission-view-all-fields-beside-record-bypass';
const entry = () => ALL_CONVERSIONS.find((c) => c.id === ID)!;

const setWith = (objects: Record<string, unknown>) => ({
  name: 'field_auditor',
  label: 'Field Auditor',
  objects,
});
const stackWith = (objects: Record<string, unknown>) => ({ permissions: [setWith(objects)] });
const chain = (stack: Record<string, unknown>) => applyMetaMigrations(structuredClone(stack), 18, 19);
const objectsAfter = (result: { stack: Record<string, unknown> }) =>
  ((result.stack.permissions as any[])[0].objects) as Record<string, Record<string, unknown>>;

describe(ID, () => {
  it('is registered at protocol 19, retired from the load path, and wired into the step-19 chain', () => {
    expect(entry().toMajor).toBe(19);
    expect(entry().retiredFromLoadPath).toBe(true);
    expect(CONVERSIONS_BY_MAJOR[19]!.map((c) => c.id)).toContain(ID);
    expect(MIGRATIONS_BY_MAJOR[19]!.conversionIds).toContain(ID);
    const result = chain(stackWith({ crm_lead: { allowRead: true, viewAllRecords: true } }));
    expect(result.applied.map((a) => a.conversionId)).toContain(ID);
  });

  it('writes `viewAllFields: true` beside View All, beside Modify All and on the wildcard, and says which bit voted', () => {
    const result = chain(stackWith({
      crm_lead: { allowRead: true, viewAllRecords: true },
      crm_deal: { allowRead: true, allowEdit: true, modifyAllRecords: true },
      '*': { allowRead: true, viewAllRecords: true },
    }));
    const after = objectsAfter(result);
    expect(after.crm_lead!.viewAllFields).toBe(true);
    expect(after.crm_deal!.viewAllFields).toBe(true);
    expect(after['*']!.viewAllFields).toBe(true);
    const mine = result.applied.filter((a) => a.conversionId === ID);
    expect(mine.map((a) => a.path).sort()).toEqual([
      'permissions[0].objects.*.viewAllFields',
      'permissions[0].objects.crm_deal.viewAllFields',
      'permissions[0].objects.crm_lead.viewAllFields',
    ]);
    expect(mine.find((a) => a.path.includes('crm_deal'))!.from).toContain('modifyAllRecords');
    expect(mine.find((a) => a.path.includes('crm_lead'))!.from).toContain('viewAllRecords');
  });

  it('leaves an entry whose author wrote `viewAllFields` alone — either value — and an entry with no record bypass', () => {
    const objects = {
      crm_lead: { allowRead: true, viewAllRecords: true, viewAllFields: false },
      crm_deal: { allowRead: true, modifyAllRecords: true, viewAllFields: true },
      crm_note: { allowRead: true, allowEdit: true },
      crm_task: { allowRead: true, viewAllRecords: false, modifyAllRecords: false },
    };
    const result = chain(stackWith(objects));
    expect(objectsAfter(result)).toEqual(objects);
    expect(result.applied.filter((a) => a.conversionId === ID)).toEqual([]);
  });

  it('never touches the field rows: a `readable: false` row stays as written', () => {
    const stack = {
      permissions: [{
        ...setWith({ crm_lead: { allowRead: true, viewAllRecords: true } }),
        fields: { 'crm_lead.score': { readable: false } },
      }],
    };
    const result = chain(stack);
    expect((result.stack.permissions as any[])[0].fields).toEqual({ 'crm_lead.score': { readable: false } });
  });

  it('is idempotent: the migrated stack replays to itself with nothing applied', () => {
    const first = chain(stackWith({ crm_lead: { allowRead: true, viewAllRecords: true } }));
    const again = applyMetaMigrations(structuredClone(first.stack), 18, 19);
    expect(again.stack).toEqual(first.stack);
    expect(again.applied.filter((a) => a.conversionId === ID)).toEqual([]);
  });

  it('⛔ never replays on the authoring funnel — View All written against the 19 contract gets no field bypass', () => {
    const authored = stackWith({ crm_lead: { allowRead: true, viewAllRecords: true } });
    const notices: ConversionNotice[] = [];
    const out = normalizeStackInput(structuredClone(authored), { onConversionNotice: (n) => notices.push(n) });
    expect(out).toEqual(authored);
    expect(notices.map((n) => n.conversionId)).not.toContain(ID);
  });

  describe('⛔ a stored permission set is read with the 19 meaning and never rewritten (ruling option A)', () => {
    const stored = () => setWith({
      crm_lead: { allowRead: true, viewAllRecords: true },
      '*': { allowRead: true, modifyAllRecords: true, allowEdit: true, allowDelete: true },
    });

    it('`applyConversionsToStoredItem` refuses it by id, for the singular and the plural row spelling', () => {
      for (const type of ['permission', 'permissions']) {
        const row = stored();
        const notices: ConversionNotice[] = [];
        const out = applyConversionsToStoredItem(type, row, { onNotice: (n) => notices.push(n) });
        expect(out, type).toEqual(stored());
        expect(notices.map((n) => n.conversionId), type).not.toContain(ID);
      }
    });

    it('a caller cannot opt back in: its own `excludeConversionIds` adds to the refusal, never replaces it', () => {
      const out = applyConversionsToStoredItem('permission', stored(), { excludeConversionIds: ['some-other-id'] });
      expect(out).toEqual(stored());
      const outEmpty = applyConversionsToStoredItem('permission', stored(), { excludeConversionIds: [] });
      expect(outEmpty).toEqual(stored());
    });

    it('FIRING CONTROL: the same bytes with the retired window open and no refusal are rewritten', () => {
      const fired = applyConversions({ permissions: [stored()] }, { includeRetired: true });
      const objects = (fired.permissions as any[])[0].objects as Record<string, Record<string, unknown>>;
      expect(objects.crm_lead!.viewAllFields).toBe(true);
      expect(objects['*']!.viewAllFields).toBe(true);
    });

    it('other retired entries still replay over a stored permission row — the refusal is by id, not by type', () => {
      // `permission-modify-all-allow-delete-false-to-true` (protocol 18) is a
      // lossless rewrite the stored pass exists for.
      const row = setWith({ crm_deal: { allowRead: true, allowEdit: true, allowDelete: false, modifyAllRecords: true } });
      const notices: ConversionNotice[] = [];
      const out = applyConversionsToStoredItem('permission', row, { onNotice: (n) => notices.push(n) }) as any;
      expect(out.objects.crm_deal.allowDelete).toBe(true);
      expect(out.objects.crm_deal.viewAllFields).toBeUndefined();
      expect(notices.map((n) => n.conversionId)).toEqual(['permission-modify-all-allow-delete-false-to-true']);
    });
  });
});
