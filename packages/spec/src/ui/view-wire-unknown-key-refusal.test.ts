// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26711 — the `view` write door refuses an unknown TOP-LEVEL key, as the
 * object, page and dashboard doors do.
 *
 * Three of `ViewMetadataSchema`'s four members — the ViewItem record and the
 * two flattened overlays — used to `.strip()` their top level. Since the save
 * stores the parsed body (#20051), a misspelt or retired key answered success
 * and was simply not stored. The container member was already closed.
 *
 * Pinned per member, because each is closed on its own: the refusal (code,
 * key, the member named), a retired key's prescription in both channels the
 * protocol has for it, the alias spellings the #20456 census found, and a
 * clean body of each shape still saving with what the console writes.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { RETIRED_KEY_UPGRADE_GUIDE_SENTENCE } from '../shared/protocol-upgrade-guide';
import { ViewMetadataSchema, diagnoseViewMetadata, type ViewMetadataBranch } from './view.zod';

const DATA = { provider: 'object', object: 'crm_lead' } as const;

/** One clean body per member the change closed, as the write path delivers it. */
const CLEAN: Record<'viewItem' | 'listOverlay' | 'formOverlay', { body: Record<string, unknown>; surface: string }> = {
  viewItem: {
    body: {
      name: 'crm_lead.mine',
      object: 'crm_lead',
      viewKind: 'list',
      label: 'Mine',
      config: { type: 'grid', data: DATA, columns: ['name'] },
      isPinned: true,
    },
    surface: 'this view item record',
  },
  listOverlay: {
    body: { name: 'crm_lead.all', object: 'crm_lead', viewKind: 'list', type: 'grid', columns: ['name'], isPinned: true },
    surface: 'this inline list view',
  },
  formOverlay: {
    body: { name: 'crm_lead.edit', object: 'crm_lead', viewKind: 'form', type: 'simple' },
    surface: 'this inline form view',
  },
};

const MEMBERS = Object.keys(CLEAN) as Array<keyof typeof CLEAN>;

/** The claimed member's issues, read the way Studio and an MCP author get them. */
function refusal(body: unknown): { branch: ViewMetadataBranch | null; issues: readonly z.core.$ZodIssue[] } {
  const parsed = ViewMetadataSchema.safeParse(body);
  expect(parsed.success, 'expected the write door to refuse this body').toBe(false);
  const diagnosis = diagnoseViewMetadata(body);
  if (diagnosis.success) throw new Error('diagnoseViewMetadata accepted a body the union refused');
  return { branch: diagnosis.branch, issues: diagnosis.issues };
}

describe('a clean body of each closed member still saves', () => {
  it.each(MEMBERS)('%s', (member) => {
    const r = ViewMetadataSchema.safeParse(CLEAN[member].body);
    expect(r.success, JSON.stringify(r.success ? null : r.error.issues)).toBe(true);
    expect(diagnoseViewMetadata(CLEAN[member].body)).toMatchObject({ success: true, branch: member });
  });

  it("the console's row ids are still removed before the parse, not refused", () => {
    const r = ViewMetadataSchema.safeParse({
      ...CLEAN.listOverlay.body,
      sort: [{ id: 'row-1', field: 'name', order: 'asc' }],
      filter: [{ id: 'row-2', field: 'name', operator: 'equals', value: 'x' }],
    });
    expect(r.success).toBe(true);
    const data = r.data as { sort: unknown[]; filter: unknown[] };
    expect(data.sort).toEqual([{ field: 'name', order: 'asc' }]);
    expect(data.filter).toEqual([{ field: 'name', operator: 'equals', value: 'x' }]);
  });
});

describe('an unknown top-level key is refused by name', () => {
  it.each(MEMBERS)('%s', (member) => {
    const { branch, issues } = refusal({ ...CLEAN[member].body, zzz_junk_key: true });
    expect(branch).toBe(member);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'unrecognized_keys', path: [], keys: ['zzz_junk_key'] });
    expect(issues[0]!.message).toMatch(
      new RegExp(`^Unrecognized key\\(s\\) on ${CLEAN[member].surface}: \`zzz_junk_key\`\\.`),
    );
  });

  it('the container member was already closed, and still is', () => {
    const { branch, issues } = refusal({ object: 'crm_lead', list: { type: 'grid', data: DATA, columns: ['name'] }, zzz_junk_key: true });
    expect(branch).toBe('container');
    expect(issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['zzz_junk_key'] });
  });
});

describe("a retired key gets the prescription its retirement kit gives it", () => {
  // `striped` was retired with the list view's other display keys, and its kit
  // has aged out (ADR-0087, amendment 2026-10-26): the refusal names the key and
  // points at the protocol upgrade guide, which holds its prescription now.
  // Before this change the overlay door answered success and dropped it.
  it.each(['listOverlay', 'viewItem'] as const)('`striped` (aged out) on %s: named, with the upgrade guide', (member) => {
    const { branch, issues } = refusal({ ...CLEAN[member].body, striped: true });
    expect(branch).toBe(member);
    expect(issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['striped'] });
    expect(issues[0]!.message).toContain(RETIRED_KEY_UPGRADE_GUIDE_SENTENCE);
  });

  // `filterableFields` still has its live tombstone on the list view shape, so
  // the overlay raises its own prescription at the key, and the union lifts it
  // to the top-level message an author at `PUT /api/v1/meta/view` reads.
  it('`filterableFields` (live tombstone) on the inline list view: its prescription, at the key', () => {
    const body = { ...CLEAN.listOverlay.body, filterableFields: ['name'] };
    const { branch, issues } = refusal(body);
    expect(branch).toBe('listOverlay');
    expect(issues[0]).toMatchObject({ code: 'invalid_type', expected: 'never', path: ['filterableFields'] });
    const parsed = ViewMetadataSchema.safeParse(body);
    expect(parsed.success ? '' : parsed.error.issues[0]!.message).toMatch(/^`view\.list\.filterableFields` was removed in @objectstack\/spec 18/);
  });
});

describe('the alias spellings the census found point at the declared key', () => {
  it.each(MEMBERS)('`objectName` on %s → `object`', (member) => {
    const { issues } = refusal({ ...CLEAN[member].body, objectName: 'crm_lead' });
    expect(issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['objectName'] });
    expect(issues[0]!.message).toContain('Did you mean `objectName` → `object`?');
  });

  it.each(MEMBERS)('a top-level `id` on %s → `name`', (member) => {
    const { issues } = refusal({ ...CLEAN[member].body, id: 'crm_lead.mine' });
    expect(issues[0]).toMatchObject({ code: 'unrecognized_keys', keys: ['id'] });
    expect(issues[0]!.message).toContain('Did you mean `id` → `name`?');
  });
});
