// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20456 — the console's round-trip keys on a stored `view` row are declared on
 * the wire members that judge that row, with their meaning, so a parse keeps
 * them (stage ii of the ruling on #20051).
 *
 * ## Why this is a closure pin
 *
 * `saveMetaItem` stores the request body verbatim (ADR-0005 appendix (c)), so a
 * key the console writes and reads back lived in the store while the members'
 * `.strip()` dropped it from the parse. Nothing failed: the parse output was
 * simply never persisted. The end state the ruling names is the parsed body
 * becoming the stored one, and it may land only once every round-trip key is
 * declared. This file is what "every" means.
 *
 * `CENSUS` below is the measurement, written down independently of the spec's
 * own record: the keys objectui's console writes onto a stored `view` row and
 * reads back, at the objectui `.objectui-sha` pin, per row shape. The pin holds
 * {@link VIEW_CONSOLE_ROUND_TRIP_KEYS} equal to it, and each (key, member) pair
 * declared, described and KEPT by a parse. Removing one declaration from a
 * member turns the pair red; adding a key to the record without the census
 * (or the reverse) turns the equality red.
 *
 * ## What the census deliberately maps elsewhere
 *
 * The alias spellings it found (`objectName`, a top-level `id`) have declared
 * spellings already (`object`, `name`); declaring the alias too would be the
 * second spelling this contract refuses. They are pinned ABSENT below, so the
 * choice is visible rather than an oversight.
 */
import { describe, expect, it } from 'vitest';
import {
  VIEW_CONSOLE_ROUND_TRIP_KEYS,
  VIEW_METADATA_MEMBERS,
  ViewItemSchema,
  ViewMetadataSchema,
  type ViewMetadataBranch,
} from './view.zod';

/**
 * The measured census (objectui at the `.objectui-sha` pin): row-shape
 * branches the console writes each key on. `viewItem` = a ViewItem record
 * (`{ name, object, viewKind, config }`), `listOverlay` = a flattened list row.
 */
const CENSUS: Record<string, readonly ViewMetadataBranch[]> = {
  isDefault: ['viewItem', 'listOverlay'],
  isPinned: ['viewItem', 'listOverlay'],
  sortOrder: ['viewItem', 'listOverlay'],
  visibility: ['viewItem', 'listOverlay'],
  columnState: ['viewItem', 'listOverlay'],
  _isOverride: ['listOverlay'],
};

/** A representative value the console writes for each key. */
const VALUE: Record<string, unknown> = {
  isDefault: true,
  isPinned: true,
  sortOrder: 3,
  visibility: 'team',
  columnState: { order: ['name'], widths: { name: 120 } },
  _isOverride: true,
};

const DATA = { provider: 'object', object: 'crm_lead' } as const;

/** One row per branch, in the shape the console stores it. */
const ROW: Record<'viewItem' | 'listOverlay', Record<string, unknown>> = {
  viewItem: {
    name: 'crm_lead.mine',
    object: 'crm_lead',
    viewKind: 'list',
    label: 'Mine',
    config: { type: 'grid', data: DATA, columns: ['name'] },
  },
  // A toolbar patch on a code-defined view: the patch, `viewKind`, and the
  // `object` / `name` the adapter stamps.
  listOverlay: { rowHeight: 'compact', viewKind: 'list', object: 'crm_lead', name: 'crm_lead.all' },
};

/** The top-level shapes of a member (both arms of the ViewItem record). */
function topLevelShapes(branch: ViewMetadataBranch): Array<Record<string, any>> {
  let def: any = (VIEW_METADATA_MEMBERS[branch] as any)._zod.def;
  while (def.type !== 'object' && def.type !== 'union') def = (def.in ?? def.innerType ?? def.schema)._zod.def;
  if (def.type === 'object') return [def.shape];
  return def.options.map((arm: any) => arm._zod.def.shape);
}

/** The field's `.describe()` meaning, on the field or under its optional wrapper. */
function meaningOf(field: any): string | undefined {
  for (let node = field; node; node = node._zod?.def?.innerType) {
    if (typeof node.description === 'string' && node.description.trim()) return node.description;
  }
  return undefined;
}

describe('VIEW_CONSOLE_ROUND_TRIP_KEYS — the census record (#20456)', () => {
  it('equals the measured census, key for key and branch for branch', () => {
    const record = Object.fromEntries(
      Object.entries(VIEW_CONSOLE_ROUND_TRIP_KEYS).map(([k, v]) => [k, [...v].sort()]),
    );
    const census = Object.fromEntries(Object.entries(CENSUS).map(([k, v]) => [k, [...v].sort()]));
    expect(record).toEqual(census);
  });
});

describe('each census key is declared on each member that judges its row (#20456)', () => {
  const pairs = Object.entries(CENSUS).flatMap(([key, branches]) => branches.map((b) => [key, b] as const));

  it.each(pairs)('`%s` is a declared, described member of `%s`', (key, branch) => {
    for (const shape of topLevelShapes(branch)) {
      expect(Object.keys(shape), `${branch} does not declare \`${key}\``).toContain(key);
      expect(meaningOf(shape[key]), `${branch}.${key} carries no \`.describe()\` meaning`).toBeTruthy();
    }
  });

  it.each(pairs)('a parse of a `%s` row through `%s` keeps it', (key, branch) => {
    const body = { ...ROW[branch as 'viewItem' | 'listOverlay'], [key]: VALUE[key] };
    const direct = VIEW_METADATA_MEMBERS[branch].safeParse(body);
    expect(direct.success, JSON.stringify(direct.success ? null : direct.error.issues)).toBe(true);
    expect((direct.data as Record<string, unknown>)[key]).toEqual(VALUE[key]);
    // …and through the union `saveMetaItem` validates with, which is the parse
    // the stored body would become.
    const union = ViewMetadataSchema.safeParse(body);
    expect(union.success).toBe(true);
    expect((union.data as Record<string, unknown>)[key]).toEqual(VALUE[key]);
  });
});

describe('the declarations are typed, not passthrough (#20456)', () => {
  it.each([
    ['isPinned', 'yes'],
    ['sortOrder', 1.5],
    ['visibility', 'everyone'],
    ['_isOverride', false],
  ])('a list overlay row with `%s: %j` is refused at that key', (key, value) => {
    const r = ViewMetadataSchema.safeParse({ ...ROW.listOverlay, [key]: value });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.success ? [] : r.error.issues)).toContain(`"${key}"`);
  });

  it('a ViewItem record with an unknown `visibility` group is refused', () => {
    expect(ViewMetadataSchema.safeParse({ ...ROW.viewItem, visibility: 'everyone' }).success).toBe(false);
  });
});

describe('what the census mapped to an existing spelling stays undeclared (#20456)', () => {
  it.each([
    ['objectName', 'object'],
    ['id', 'name'],
  ])('`%s` is declared on no member — its declared spelling is `%s`', (alias, canonical) => {
    for (const branch of Object.keys(VIEW_METADATA_MEMBERS) as ViewMetadataBranch[]) {
      for (const shape of topLevelShapes(branch)) expect(Object.keys(shape)).not.toContain(alias);
    }
    for (const branch of ['viewItem', 'listOverlay'] as const) {
      for (const shape of topLevelShapes(branch)) expect(Object.keys(shape)).toContain(canonical);
    }
  });
});

describe('the authoring door still refuses the console-only keys (#20456)', () => {
  it.each(['visibility', 'isPinned', 'sortOrder', '_isOverride'])('`defineViewItem` input with `%s` is refused by name', (key) => {
    const r = ViewItemSchema.safeParse({ ...ROW.viewItem, [key]: VALUE[key] });
    expect(r.success).toBe(false);
    const issue = r.success ? undefined : r.error.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect((issue as { keys?: string[] } | undefined)?.keys).toContain(key);
  });
});
