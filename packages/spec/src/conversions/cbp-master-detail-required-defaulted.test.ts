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
 *   refusing (and the explicit `required: false`, which it leaves alone and
 *   the parse now accepts as the optional master, #30905 ruling A);
 * - on the authoring funnel, which does not replay it. ⚠️ Since ruling A of
 *   #30905 the parse reads an omitted `required` as the parsed `false`, the
 *   optional master, so the funnel admits the omission rather than refusing
 *   it; `os lint` reports it at `error` (`relationship/master-detail-required`).
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
    // [#30905 ruling A] Before the replay the parse admits it as the optional
    // master (the parsed map reads the omitted `required` as `false`); the
    // conversion gives it the reading the row was stored with, the required
    // master, exactly as before the ruling.
    expect(cbpIssuePaths(row), 'admitted as optional before the replay').toEqual([]);

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

  it('leaves an explicit required:false untouched, and the parse accepts it as the optional master (#30905 ruling A)', () => {
    const row = cbpRow({ m: { ...STUDIO_MASTER, required: false } });
    const { item, notices } = convertStored(row);
    expect(notices).toEqual([]);
    expect(item).toEqual(row);
    expect(cbpIssuePaths(item)).toEqual([]);
  });

  it.each([
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

  it('the authoring funnel does NOT replay it — defineStack keeps the omission as the parse reads it (#30905 ruling A)', () => {
    // Reversed, not deleted: this pinned defineStack refusing the omission and
    // naming the fix. Since ruling A the parse admits the parsed `false` as the
    // optional master; that the funnel does not replay the conversion is still
    // the pin: the field comes out `required: false`, never forced to `true`.
    const stack = defineStack({
      manifest: { id: 'com.example.cbp-defaulted', namespace: 'cbpd', version: '0.0.1', type: 'app', name: 'CBP' },
      objects: [
        { name: 'cbpd_header', label: 'Header', fields: { name: { type: 'text', label: 'Name' } } },
        { name: 'cbpd_line', label: 'Line', sharingModel: 'controlled_by_parent', fields: { header: { type: 'master_detail', label: 'H', reference: 'cbpd_header' } } },
      ],
    } as never) as unknown as { objects: Array<{ fields: Record<string, { required?: boolean }> }> };
    expect(stack.objects[1]!.fields.header!.required).toBe(false);
  });
});
