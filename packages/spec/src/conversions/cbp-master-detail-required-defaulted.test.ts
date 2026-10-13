// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { ObjectSchema } from '../data/object.zod.js';
import { defineStack } from '../stack.zod.js';
import { ALL_CONVERSIONS } from './registry.js';
import { applyConversionsToStoredItem } from './stored.js';
import type { ConversionNotice } from './types.js';

/**
 * [#23100] `cbp-master-detail-required-defaulted`: the one lossless shape inside
 * ADR-0055 §1's one-master refusal, carried for data at rest.
 *
 * The fixture pair in `conversions.test.ts` proves before → after over the whole
 * table. This file pins it where it matters:
 * - on a stored row in the shape objectui's Studio writes (`{ type, label }`,
 *   with the Required toggle off), which converts to `required: true` and then
 *   parses;
 * - on the shapes it must leave alone, each of which the parse goes on
 *   refusing;
 * - on the authoring funnel, which does not replay it, so a live author is
 *   still refused and taught.
 */

const ID = 'cbp-master-detail-required-defaulted';

const cbpRow = (fields: Record<string, unknown>) => ({
  name: 'crm_line',
  label: 'Line',
  sharingModel: 'controlled_by_parent',
  fields,
});
const STUDIO_MASTER = { type: 'master_detail', label: 'Opportunity', reference: 'crm_opportunity' };

function convertStored(row: Record<string, unknown>) {
  const notices: ConversionNotice[] = [];
  const item = applyConversionsToStoredItem('object', row, { onNotice: (n) => notices.push(n) });
  return { item: item as Record<string, any>, notices: notices.filter((n) => n.conversionId === ID) };
}

/** The parse's `controlled_by_parent` issues on one object, by path. */
function cbpIssuePaths(row: unknown): string[] {
  const r = ObjectSchema.safeParse(row);
  if (r.success) return [];
  return r.error.issues
    .filter((i) => /declares sharingModel 'controlled_by_parent'/.test(i.message))
    .map((i) => i.path.join('.'));
}

describe('cbp-master-detail-required-defaulted (ADR-0087 D2)', () => {
  it('is registered for protocol 18 and retired from the authoring load path', () => {
    const entry = ALL_CONVERSIONS.find((c) => c.id === ID);
    expect(entry, 'the conversion is registered').toBeDefined();
    expect(entry!.toMajor).toBe(18);
    expect(entry!.retiredFromLoadPath).toBe(true);
  });

  it('a stored Studio-shape row (one master_detail, `required` omitted) converts to required:true, then parses whole', () => {
    const row = cbpRow({ opportunity: STUDIO_MASTER, name: { type: 'text', label: 'Name' } });
    expect(cbpIssuePaths(row), 'refused before the replay').toEqual(['sharingModel']);

    const { item, notices } = convertStored(row);
    expect(notices).toHaveLength(1);
    expect(notices[0].path).toBe('objects[0].fields.opportunity.required');
    expect(item.fields.opportunity).toEqual({ ...STUDIO_MASTER, required: true });
    expect(item.fields.name).toEqual({ type: 'text', label: 'Name' });
    expect(ObjectSchema.safeParse(item).success).toBe(true);
    // Copy-on-write: the stored row itself is not mutated.
    expect('required' in (row.fields.opportunity as object)).toBe(false);

    // Idempotent: a second pass finds nothing to convert.
    expect(convertStored(item).notices).toEqual([]);
  });

  it.each([
    ['an explicit required:false (the builder refuses it too)', { m: { ...STUDIO_MASTER, required: false } }, 'sharingModel'],
    [
      'two master_details (no pick)',
      { a: STUDIO_MASTER, b: { type: 'master_detail', label: 'Quote', reference: 'crm_quote' } },
      'sharingModel',
    ],
    [
      'a required lookup (the retired third tier)',
      { m: { type: 'lookup', label: 'Campaign', reference: 'crm_campaign', required: true } },
      'sharingModel',
    ],
  ])('leaves %s untouched, and the parse still refuses it', (_label, fields, path) => {
    const row = cbpRow(fields);
    const { item, notices } = convertStored(row);
    expect(notices).toEqual([]);
    expect(item).toEqual(row);
    expect(cbpIssuePaths(item)).toEqual([path]);
  });

  it('touches no other sharing model', () => {
    const row = { ...cbpRow({ m: STUDIO_MASTER }), sharingModel: 'private' };
    const { item, notices } = convertStored(row);
    expect(notices).toEqual([]);
    expect(item.fields.m).toEqual(STUDIO_MASTER);
  });

  it('the authoring funnel does NOT replay it — defineStack still refuses the same shape and names the fix', () => {
    expect(() =>
      defineStack({
        manifest: { id: 'com.example.cbp-defaulted', namespace: 'cbpd', version: '0.0.1', type: 'app', name: 'CBP' },
        objects: [
          { name: 'cbpd_header', label: 'Header', fields: { name: { type: 'text', label: 'Name' } } },
          { name: 'cbpd_line', label: 'Line', sharingModel: 'controlled_by_parent', fields: { header: { type: 'master_detail', label: 'H', reference: 'cbpd_header' } } },
        ],
      } as never),
    ).toThrow(/`header` is a `master_detail` without `required: true` — add it/);
  });
});
