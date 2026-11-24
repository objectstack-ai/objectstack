// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A stored `view` row's `columnState` RETIRED (#36403) — ADR-0049
 * enforce-or-remove, the spec half of #35955 (maintainer, 2026-11-21: column
 * widths 「只记在浏览器里」, and the server-side per-user list preference layer
 * 「整个退掉」).
 *
 * The key was the console grid's per-user column order and widths, declared on
 * both wire doors of the `view` union — the view item RECORD (member 1) and the
 * flattened OVERLAY (members 3 and 4) — and on `VIEW_CONSOLE_ROUND_TRIP_KEYS`.
 * No writer is left (census in the `VIEW_COLUMN_STATE_RETIRED` docblock).
 *
 * Bookkeeping shapes, pinned below:
 *   1. One `retiredKey()` text on all three members. The authoring doors never
 *      declared the key; their `guidance` names the retirement.
 *   2. D2 conversion `view-column-state-removed` (step 18), one family on both
 *      spellings, reaching `views` and `viewItems`, leaving containers alone.
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries `ui/ViewItemWire:columnState` and
 *      `ui/ViewMetadata:columnState` — declared, not judged (neither def emits
 *      top-level `properties`).
 *   4. One D3 semantic entry, `view-column-state-retired`.
 *   5. The column-state-only overlay residue: the strip leaves identity only,
 *      which the door refuses.
 */

import { describe, expect, it } from 'vitest';

import { collectConversionNotices } from '../conversions/apply';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { AssembledViewArtifactSchema } from './assembled-views.zod';
import {
  ListViewSchema,
  VIEW_CONSOLE_ROUND_TRIP_KEYS,
  VIEW_METADATA_MEMBERS,
  ViewItemSchema,
  ViewMetadataSchema,
} from './view.zod';

const LIST_OVERLAY = { name: 'crm_lead.all', object: 'crm_lead', viewKind: 'list' } as const;
const FORM_OVERLAY = { name: 'crm_lead.edit', object: 'crm_lead', viewKind: 'form' } as const;
const RECORD = {
  name: 'crm_lead.mine',
  object: 'crm_lead',
  viewKind: 'list',
  config: { type: 'grid', columns: ['name'] },
} as const;

/** What the console grid wrote, measured on objectui#5233. */
const VALUE = { order: ['email', 'name'], widths: { email: 240 } } as const;

// Unanchored: a thrown `ZodError`'s message is the JSON of its issues. The
// key-first convention is asserted on the issue message itself below.
const PRESCRIPTION = /`view\.columnState` was removed in @objectstack\/spec 18\.7\.0 \(ADR-0049.*Delete the key\..*`os migrate meta --from 17`/s;
const LIST_BODY_PRESCRIPTION = /`listView\.columnState` was removed in @objectstack\/spec 18\.7\.0 \(ADR-0049.*Delete the key\./s;

type Issue = { code: string; path: PropertyKey[]; message: string; errors?: Issue[][] };

const MEMBERS = [
  ['viewItem', VIEW_METADATA_MEMBERS.viewItem, RECORD],
  ['listOverlay', VIEW_METADATA_MEMBERS.listOverlay, LIST_OVERLAY],
  ['formOverlay', VIEW_METADATA_MEMBERS.formOverlay, FORM_OVERLAY],
] as const;

describe('columnState retirement — the tombstone, at every door that parses a stored row', () => {
  for (const [member, schema, row] of MEMBERS) {
    it(`the ${member} member refuses \`columnState\` at its path with the prescription`, () => {
      const r = schema.safeParse({ ...row, columnState: VALUE });
      expect(r.success).toBe(false);
      if (r.success) return;
      const issue = r.error.issues.find((i) => i.path[0] === 'columnState');
      expect(issue, 'the refusal must name `columnState`').toBeDefined();
      expect(issue!.code).toBe('invalid_type');
      expect(issue!.path).toEqual(['columnState']);
      expect(issue!.message).toMatch(PRESCRIPTION);
      expect(issue!.message.startsWith('`view.columnState` was removed')).toBe(true);
    });
  }

  it('the `view` write door refuses every row shape carrying it, the claimed member locating the key', () => {
    const door = getMetadataTypeSchema('view');
    expect(door).toBe(ViewMetadataSchema);
    for (const row of [LIST_OVERLAY, FORM_OVERLAY, RECORD]) {
      const r = door!.safeParse({ ...row, columnState: VALUE });
      expect(r.success, JSON.stringify(row)).toBe(false);
      if (r.success) continue;
      const top = r.error.issues[0] as unknown as Issue;
      expect(top.message).toMatch(PRESCRIPTION);
    }
  });

  it('the assembled-manifest channel refuses it too — which is why the D2 conversion reaches `viewItems`', () => {
    expect(AssembledViewArtifactSchema.safeParse({ ...LIST_OVERLAY, columnState: VALUE }).success).toBe(false);
    expect(AssembledViewArtifactSchema.safeParse({ ...RECORD, columnState: VALUE }).success).toBe(false);
  });

  it('the authoring doors, which never declared it, refuse it by name with the retirement text', () => {
    const item = ViewItemSchema.safeParse({ ...RECORD, columnState: VALUE });
    expect(item.success).toBe(false);
    if (!item.success) expect(JSON.stringify(item.error.issues)).toMatch(PRESCRIPTION);

    const list = ListViewSchema.safeParse({ type: 'grid', columns: ['name'], columnState: VALUE });
    expect(list.success).toBe(false);
    if (!list.success) expect(JSON.stringify(list.error.issues)).toMatch(LIST_BODY_PRESCRIPTION);

    // …and a record whose CONFIG carries it: the record member judges `config`
    // with the strict list shape.
    expect(ViewMetadataSchema.safeParse({
      ...RECORD,
      config: { ...RECORD.config, columnState: VALUE },
    }).success).toBe(false);
  });

  it('CONTROL: the same rows without the key pass every door, and grow no `columnState`', () => {
    for (const [label, schema, body] of [
      ['viewItem member', VIEW_METADATA_MEMBERS.viewItem, { ...RECORD, isPinned: true }],
      ['listOverlay member', VIEW_METADATA_MEMBERS.listOverlay, { ...LIST_OVERLAY, isDefault: true }],
      ['formOverlay member', VIEW_METADATA_MEMBERS.formOverlay, { ...FORM_OVERLAY, isDefault: true }],
      ['door (list)', ViewMetadataSchema, { ...LIST_OVERLAY, hiddenFields: ['name'] }],
    ] as const) {
      const r = schema.safeParse(body);
      expect(r.success, `${label} must accept the row`).toBe(true);
      if (!r.success) continue;
      expect(r.data as Record<string, unknown>, label).not.toHaveProperty('columnState');
    }
  });

  it('is gone from the console round-trip record, so no console derivation carries it', () => {
    expect(Object.keys(VIEW_CONSOLE_ROUND_TRIP_KEYS)).not.toContain('columnState');
  });
});

describe('columnState retirement — the D2 conversion', () => {
  it('a STORED overlay row carrying it rehydrates clean, then parses at the door', () => {
    const stored = { ...LIST_OVERLAY, isDefault: true, columnState: VALUE };
    const notices: { conversionId?: string; path?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('view', stored, {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string }),
    }) as Record<string, unknown>;
    expect(notices.map((n) => [n.conversionId, n.path])).toEqual([
      ['view-column-state-removed', 'views[0].columnState'],
    ]);
    expect(rehydrated).not.toHaveProperty('columnState');
    expect(rehydrated.isDefault).toBe(true);
    expect(ViewMetadataSchema.safeParse(rehydrated).success).toBe(true);
    // CONTROL: the stored row itself, unconverted, is what the door now refuses.
    expect(ViewMetadataSchema.safeParse(stored).success).toBe(false);
  });

  it('a STORED record carrying it rehydrates clean, `config` untouched', () => {
    const stored = { ...RECORD, isPinned: true, columnState: VALUE };
    const rehydrated = applyConversionsToStoredItem('view', stored) as Record<string, unknown>;
    expect(rehydrated).toEqual({ ...RECORD, isPinned: true });
    expect(ViewMetadataSchema.safeParse(rehydrated).success).toBe(true);
  });

  it('reaches `viewItems`, strips both spellings once each, and leaves containers alone', () => {
    const container = { object: 'crm_lead', list: { type: 'grid', columns: ['name'] } };
    const { stack, notices } = collectConversionNotices(
      {
        viewItems: [{ ...LIST_OVERLAY, columnState: VALUE }, { ...RECORD, columnState: VALUE }],
        views: [container],
      },
      { includeRetired: true },
    );
    expect(notices.map((n) => [n.conversionId, n.path])).toEqual([
      ['view-column-state-removed', 'viewItems[0].columnState'],
      ['view-column-state-removed', 'viewItems[1].columnState'],
    ]);
    expect(stack).toEqual({ viewItems: [LIST_OVERLAY, RECORD], views: [container] });
    for (const entry of stack.viewItems as unknown[]) {
      expect(AssembledViewArtifactSchema.safeParse(entry).success).toBe(true);
    }

    // Idempotence, measured: a second replay converts nothing and hands the
    // input back by reference (copy-on-write).
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices).toHaveLength(0);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — a live author is refused at parse, never silently rewritten', () => {
    const { stack, notices } = collectConversionNotices({ views: [{ ...LIST_OVERLAY, columnState: VALUE }] });
    expect(notices).toHaveLength(0);
    expect(stack).toEqual({ views: [{ ...LIST_OVERLAY, columnState: VALUE }] });
  });
});

/**
 * The column-state-only overlay — what a column drag on a system view wrote
 * before objectui#12504: identity plus `columnState`. The strip leaves identity
 * only, which the identity precondition refuses. Stated in the D2 docblock,
 * the D3 acceptance criteria and the changeset; pinned here so they stay true.
 */
describe('columnState retirement — the column-state-only residue', () => {
  it('strips to identity only, which the door refuses as "only identity fields"', () => {
    const rehydrated = applyConversionsToStoredItem('view', { ...LIST_OVERLAY, _isOverride: true, columnState: VALUE });
    // `_isOverride` is the console's settings-overlay marker, a declared
    // round-trip key — so a marked row is NOT identity-only and stays valid.
    expect(ViewMetadataSchema.safeParse(rehydrated).success).toBe(true);

    const bare = applyConversionsToStoredItem('view', { ...LIST_OVERLAY, columnState: VALUE });
    expect(bare).toEqual(LIST_OVERLAY);
    const r = ViewMetadataSchema.safeParse(bare);
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues).toHaveLength(1);
    expect(r.error.issues[0]!.code).toBe('custom');
    expect(r.error.issues[0]!.message).toContain('only identity fields');
    expect(r.error.issues[0]!.message).not.toMatch(/was removed in @objectstack\/spec/);
  });
});

describe('columnState retirement — ADR-0087 registration', () => {
  it('declares the key on both doors under major 18, with the D2 entry in the step-18 chain', () => {
    for (const key of ['ui/ViewItemWire:columnState', 'ui/ViewMetadata:columnState']) {
      expect(RETIRED_KEYS_BY_MAJOR[18], key).toContain(key);
    }
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain('view-column-state-removed');
  });

  it('carries ONE D3 semantic entry, naming its D2 conversion, the measured zero and the unmeasured population', () => {
    const semantic = MIGRATIONS_BY_MAJOR[18]!.semantic;
    const family = semantic.filter((s) => s.id === 'view-column-state-retired');
    expect(family).toHaveLength(1);
    const entry = family[0]!;
    expect(entry.reason).toContain('`view-column-state-removed`');
    expect(entry.reason).toContain('NOT MEASURED');
    expect(entry.acceptanceCriteria).toContain('only identity fields');
    const naming = semantic.filter((s) => JSON.stringify(s).includes('view-column-state-removed'));
    expect(naming.map((s) => s.id)).toEqual(['view-column-state-retired']);
  });
});
