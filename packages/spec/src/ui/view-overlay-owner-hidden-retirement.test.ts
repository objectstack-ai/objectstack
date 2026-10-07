// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The flattened view overlay's `owner` / `hidden` RETIRED (#20230) — ADR-0049
 * enforce-or-remove; triage direction, verbatim: 「follow #20085's disposition
 * for the same key pair」.
 *
 * The overlay door — the lean personalization PUT with no `config`, members 3
 * and 4 of the `view` union — declared both keys in
 * `flattenedViewOverlayFields()`, separately from the view item's pair that
 * #20085 retired. It accepted them, the write door stored them verbatim, and
 * nothing read either. Writer census before removal (recorded beside the
 * prescriptions in `view.zod.ts`): none in this framework or its examples, in
 * objectui at its pin and at `main`, or in the HotCRM app.
 *
 * Bookkeeping shapes, pinned below:
 *   1. Both keys are `retiredKey()` tombstones on the two overlay members, with
 *      the view item's OWN prescription texts — one family, one text. Both
 *      members `.strip()`, so a bare deletion would drop the key in silence
 *      (ADR-0104); the tombstone makes every door that parses an overlay refuse.
 *   2. D2 conversion `view-overlay-owner-hidden-removed` (step 18), scoped to
 *      the FLATTENED spelling and disjoint from the view item's entry by
 *      `config`, reaching `views` (stack sources, stored rows) and `viewItems`
 *      (the assembled-manifest channel).
 *   3. `RETIRED_KEYS_BY_MAJOR[18]` carries `ui/ViewMetadata:*` — declared, not
 *      judged: `ui/ViewMetadata` is unemitted, so no build gate sees the rows.
 *   4. The family's one D3 semantic entry, `view-overlay-owner-hidden-retired`
 *      (ruling B on #17152), naming its D2 conversion by id. The view item
 *      record's pair is a separate family with its own conversion and its own
 *      D3 entry; the two share the prescription texts, not a record.
 *
 * `defineView` is NOT an overlay door: it parses the strict container
 * (`ViewSchema`), which declares neither key and refuses an overlay-shaped
 * body as a container — pinned below as the control that no `define*` factory
 * reaches the overlay members. The save door's ADR-0112 envelope (`code` +
 * `status`) is pinned where it is produced, in `@objectstack/metadata-protocol`
 * (`protocol.save-union-issues.test.ts`); a schema refusal here is a
 * `ZodError`, whose issues carry `code` and `path` but no `status`.
 */

import { describe, expect, it } from 'vitest';

import { collectConversionNotices } from '../conversions/apply';
import { applyConversionsToStoredItem } from '../conversions/stored';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { AssembledViewArtifactSchema } from './assembled-views.zod';
import {
  VIEW_METADATA_MEMBERS,
  ViewItemWireSchema,
  ViewMetadataSchema,
  defineView,
} from './view.zod';

/** A bound flattened LIST overlay — the shape the console's toolbar saves, neither retired key. */
const LIST_OVERLAY = { name: 'crm_lead.all', object: 'crm_lead', viewKind: 'list' } as const;
/** A bound flattened FORM overlay. */
const FORM_OVERLAY = { name: 'crm_lead.edit', object: 'crm_lead', viewKind: 'form' } as const;
/** A well-formed ViewItem record — the other door of the same family. */
const RECORD = {
  name: 'crm_lead.my_hot_leads',
  object: 'crm_lead',
  viewKind: 'list',
  config: { type: 'grid', columns: ['name'] },
} as const;

// Unanchored, because a thrown `ZodError`'s message is the JSON of its issues;
// the key-first house convention is asserted on the issue message itself below.
const OWNER_PRESCRIPTION = /`view\.owner` was removed in @objectstack\/spec 17\.5\.0 \(ADR-0049.*Delete the key\..*`os migrate meta --from 17`/s;
const HIDDEN_PRESCRIPTION = /`view\.hidden` was removed in @objectstack\/spec 17\.5\.0 \(ADR-0049.*Delete the key;.*`os migrate meta --from 17`/s;

const RETIRED = [
  ['owner', 'usr_7', OWNER_PRESCRIPTION],
  ['hidden', true, HIDDEN_PRESCRIPTION],
] as const;

const MEMBERS = [
  ['listOverlay', VIEW_METADATA_MEMBERS.listOverlay, LIST_OVERLAY],
  ['formOverlay', VIEW_METADATA_MEMBERS.formOverlay, FORM_OVERLAY],
] as const;

type Issue = { code: string; path: PropertyKey[]; message: string; errors?: Issue[][] };

describe('overlay owner/hidden retirement — the tombstones, at every door that parses an overlay', () => {
  for (const [key, value, prescription] of RETIRED) {
    for (const [member, schema, overlay] of MEMBERS) {
      it(`the ${member} member refuses \`${key}\` at its path instead of stripping it`, () => {
        // ⭐ The half a bare deletion would have lost: both members `.strip()`.
        const r = schema.safeParse({ ...overlay, [key]: value });
        expect(r.success).toBe(false);
        if (r.success) return;
        const issue = r.error.issues.find((i) => i.path[0] === key);
        expect(issue, `the refusal must name \`${key}\``).toBeDefined();
        expect(issue!.code).toBe('invalid_type');
        expect(issue!.path).toEqual([key]);
        expect(issue!.message).toMatch(prescription);
        // House convention 1: the fully-qualified key, in backticks, opens it.
        expect(issue!.message.startsWith(`\`view.${key}\` was removed`)).toBe(true);
      });
    }

    it(`the overlay's \`${key}\` text IS the view item's — one family, one prescription`, () => {
      const onOverlay = VIEW_METADATA_MEMBERS.listOverlay.safeParse({ ...LIST_OVERLAY, [key]: value });
      const onRecord = ViewItemWireSchema.safeParse({ ...RECORD, [key]: value });
      expect(onOverlay.success || onRecord.success).toBe(false);
      if (onOverlay.success || onRecord.success) return;
      const a = onOverlay.error.issues.find((i) => i.path[0] === key)!.message;
      const b = onRecord.error.issues.find((i) => i.path[0] === key)!.message;
      expect(a).toBe(b);
    });

    it(`the \`view\` write door (the registry binding) refuses a bound overlay carrying \`${key}\``, () => {
      // `getMetadataTypeSchema('view')` is what `saveMetaItem` validates a
      // `PUT /api/v1/meta/view/:name` body against.
      const door = getMetadataTypeSchema('view');
      expect(door).toBe(ViewMetadataSchema);
      for (const overlay of [LIST_OVERLAY, FORM_OVERLAY]) {
        const r = door!.safeParse({ ...overlay, [key]: value });
        expect(r.success, `${overlay.viewKind} overlay`).toBe(false);
        if (r.success) continue;
        const top = r.error.issues[0] as unknown as Issue;
        expect(top.code).toBe('invalid_union');
        // The claimed member's own message surfaces on the union…
        expect(top.message).toMatch(prescription);
        // …and that member's issue still locates the key.
        const located = (top.errors ?? []).flat().find((i) => i.path[0] === key);
        expect(located, 'the claimed overlay member must locate the key').toBeDefined();
        expect(located!.code).toBe('invalid_type');
        expect(located!.message).toMatch(prescription);
      }
    });

    it(`the assembled-manifest channel refuses an overlay carrying \`${key}\``, () => {
      // Built from the same members, so it refuses too — which is why the D2
      // conversion must reach `viewItems` (pinned below).
      expect(AssembledViewArtifactSchema.safeParse({ ...LIST_OVERLAY, [key]: value }).success).toBe(false);
      expect(AssembledViewArtifactSchema.safeParse({ ...FORM_OVERLAY, [key]: value }).success).toBe(false);
    });
  }

  it('CONTROL: the same overlays without the keys pass every door, live round-trip keys intact', () => {
    const live = { isDefault: true, order: 2, scope: 'shared', label: 'Leads' } as const;
    for (const [label, schema, body] of [
      ['listOverlay member', VIEW_METADATA_MEMBERS.listOverlay, { ...LIST_OVERLAY, ...live }],
      ['formOverlay member', VIEW_METADATA_MEMBERS.formOverlay, { ...FORM_OVERLAY, ...live }],
      ['door (list)', ViewMetadataSchema, { ...LIST_OVERLAY, ...live }],
      ['door (form)', ViewMetadataSchema, { ...FORM_OVERLAY, ...live }],
      ['assembled (list)', AssembledViewArtifactSchema, { ...LIST_OVERLAY, ...live }],
    ] as const) {
      const r = schema.safeParse(body);
      expect(r.success, `${label} must accept the overlay`).toBe(true);
      if (!r.success) continue;
      const data = r.data as Record<string, unknown>;
      // The strip path: absence stays absence.
      expect(data, `${label} grows no \`owner\``).not.toHaveProperty('owner');
      expect(data, `${label} grows no \`hidden\``).not.toHaveProperty('hidden');
      // The live neighbours are untouched by the tombstones.
      expect(data.isDefault, `${label} keeps \`isDefault\``).toBe(true);
      expect(data.order, `${label} keeps \`order\``).toBe(2);
      expect(data.scope, `${label} keeps \`scope\``).toBe('shared');
    }
  });

  it('CONTROL: the view item door refuses the pair too — the family is closed on both doors', () => {
    for (const [key, value, prescription] of RETIRED) {
      const r = ViewMetadataSchema.safeParse({ ...RECORD, [key]: value });
      expect(r.success).toBe(false);
      if (r.success) continue;
      expect(r.error.issues[0]!.message).toMatch(prescription);
    }
    expect(ViewMetadataSchema.safeParse(RECORD).success).toBe(true);
  });

  it('CONTROL: `defineView` is the container door, not an overlay door — it never reached these members', () => {
    // An overlay-shaped body is not a container: the strict `ViewSchema` names
    // `object`/`viewKind`/`hidden` as unknown keys. Pre-existing, and the reason
    // no `define*` factory needed a tombstone for this retirement.
    expect(() => defineView({ ...LIST_OVERLAY, hidden: true } as never)).toThrow(/hidden/);
    expect(() => defineView({ ...LIST_OVERLAY } as never)).toThrow();
  });
});

describe('overlay owner/hidden retirement — the D2 conversion', () => {
  it('a STORED overlay row carrying the keys rehydrates clean, then parses at the door', () => {
    // Every read of a stored `view` row replays the chain as `{ views: [row] }`
    // before the row is served or badged (`convertStoredItem`).
    const stored = { ...FORM_OVERLAY, label: 'Edit lead', isDefault: true, owner: 'usr_7', hidden: true };
    const notices: { conversionId?: string; path?: string }[] = [];
    const rehydrated = applyConversionsToStoredItem('view', stored, {
      onNotice: (n) => notices.push(n as { conversionId?: string; path?: string }),
    }) as Record<string, unknown>;

    expect(notices.map((n) => n.conversionId)).toEqual([
      'view-overlay-owner-hidden-removed',
      'view-overlay-owner-hidden-removed',
    ]);
    expect(notices.map((n) => n.path)).toEqual(['views[0].owner', 'views[0].hidden']);
    expect(rehydrated).not.toHaveProperty('owner');
    expect(rehydrated).not.toHaveProperty('hidden');
    // CONTROL: the live round-trip keys on the same row survive.
    expect(rehydrated.isDefault).toBe(true);
    expect(rehydrated.label).toBe('Edit lead');
    // …and, because this row carries content (`isDefault`), the rehydrated row
    // is what the write door accepts now, so a whole-row re-save of it saves.
    // The row that carries NO content is the residue pinned below.
    expect(ViewMetadataSchema.safeParse(rehydrated).success).toBe(true);
    // CONTROL: the stored row itself, unconverted, is what the door now refuses.
    expect(ViewMetadataSchema.safeParse(stored).success).toBe(false);
  });

  it('strips a flat row that has no `viewKind` yet — the write path heals that in, then would refuse the key', () => {
    const { stack, notices } = collectConversionNotices(
      { views: [{ name: 'crm_lead.all', type: 'grid', columns: ['name'], hidden: true }] },
      { includeRetired: true },
    );
    expect(notices.map((n) => [n.conversionId, n.path])).toEqual([
      ['view-overlay-owner-hidden-removed', 'views[0].hidden'],
    ]);
    expect(stack).toEqual({ views: [{ name: 'crm_lead.all', type: 'grid', columns: ['name'] }] });
  });

  it('reaches `viewItems`, is disjoint from the record entry by `config`, and leaves containers alone', () => {
    const { stack, notices } = collectConversionNotices(
      {
        viewItems: [
          { ...LIST_OVERLAY, hidden: false },
          // A record in the same channel: the view item's entry strips it.
          { ...RECORD, owner: 'usr_7' },
        ],
        // A container carries neither key and has no top-level overlay body.
        views: [{ object: 'crm_lead', list: { type: 'grid', columns: ['name'] } }],
      },
      { includeRetired: true },
    );
    // Each door's key is stripped by that door's own entry — never by both.
    expect(notices.map((n) => [n.conversionId, n.path])).toEqual([
      ['view-item-owner-hidden-removed', 'viewItems[1].owner'],
      ['view-overlay-owner-hidden-removed', 'viewItems[0].hidden'],
    ]);
    expect(stack).toEqual({
      viewItems: [LIST_OVERLAY, RECORD],
      views: [{ object: 'crm_lead', list: { type: 'grid', columns: ['name'] } }],
    });
    // Both converted entries parse through the assembled channel they travel in.
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
    const { stack, notices } = collectConversionNotices({ views: [{ ...LIST_OVERLAY, hidden: true }] });
    expect(notices).toHaveLength(0);
    expect(stack).toEqual({ views: [{ ...LIST_OVERLAY, hidden: true }] });
  });
});

/**
 * The hide-only residue — the one stored class the strip cannot bring back
 * into the accept set, stated in the D2 docblock, the D3 acceptance criteria
 * and the changeset, and pinned here so those sentences stay true.
 *
 * The card's own measured shape, `{ object, viewKind, hidden: true }` (plus the
 * `name` the write path stamps), holds nothing but identity and a retired key.
 * The strip leaves IDENTITY ONLY, and the `view` door's identity precondition
 * (#5599 / #7741 — `assertViewIdentity`) refuses a body that says which view it
 * attaches to and nothing about what the view is. So the row is served badged
 * invalid, a whole-row re-save is refused (the save-door half of this pin is
 * in `@objectstack/metadata-protocol`'s `protocol.save-union-issues.test.ts`),
 * and `os migrate meta --stored --apply` reports it `failed`. Remedy: delete
 * the row, or add the personalization setting its author meant.
 */
describe('overlay owner/hidden retirement — the hide-only residue', () => {
  const IDENTITY = { name: 'crm_lead.all', object: 'crm_lead', viewKind: 'list' } as const;

  for (const [label, retired] of [
    ['hidden', { hidden: true }],
    ['owner', { owner: 'usr_7' }],
    ['both', { hidden: true, owner: 'usr_7' }],
  ] as const) {
    it(`a stored hide-only row (${label}) strips to identity only, which the door refuses as "only identity fields"`, () => {
      const stored = { ...IDENTITY, ...retired };
      const notices: { conversionId?: string }[] = [];
      const rehydrated = applyConversionsToStoredItem('view', stored, {
        onNotice: (n) => notices.push(n as { conversionId?: string }),
      });
      // The strip itself is exact: identity, and nothing else.
      expect(rehydrated).toEqual(IDENTITY);
      expect(notices.length).toBe(Object.keys(retired).length);
      expect(notices.every((n) => n.conversionId === 'view-overlay-owner-hidden-removed')).toBe(true);

      // …and identity alone is not a `view` body: the precondition's own words,
      // one `custom` issue at the root — NOT the retirement prescription, which
      // has nothing left to locate.
      const r = ViewMetadataSchema.safeParse(rehydrated);
      expect(r.success).toBe(false);
      if (r.success) return;
      expect(r.error.issues).toHaveLength(1);
      expect(r.error.issues[0]!.code).toBe('custom');
      expect(r.error.issues[0]!.path).toEqual([]);
      expect(r.error.issues[0]!.message).toContain('Not a `view` body');
      expect(r.error.issues[0]!.message).toContain('only identity fields');
      expect(r.error.issues[0]!.message).toContain('the write path stamps them itself');
      expect(r.error.issues[0]!.message).not.toMatch(/was removed in @objectstack\/spec/);
    });
  }

  it('a rename adds only identity (`label`), so it is refused too', () => {
    const r = ViewMetadataSchema.safeParse({ ...IDENTITY, label: 'All leads' });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues[0]!.message).toContain('only identity fields');
  });

  it('CONTROL: a write that adds a real view key (a toolbar toggle) saves — the residue is the identity-only body, not the row', () => {
    for (const toggle of [{ isDefault: true }, { order: 2 }, { columnState: { widths: { name: 120 } } }]) {
      expect(ViewMetadataSchema.safeParse({ ...IDENTITY, ...toggle }).success, JSON.stringify(toggle)).toBe(true);
    }
  });
});

describe('overlay owner/hidden retirement — ADR-0087 registration', () => {
  it('declares both keys on the overlay door under major 18, with the D2 entry in the step-18 chain', () => {
    for (const key of ['ui/ViewMetadata:owner', 'ui/ViewMetadata:hidden']) {
      expect(RETIRED_KEYS_BY_MAJOR[18], key).toContain(key);
    }
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain('view-overlay-owner-hidden-removed');
  });

  it('the family carries ONE D3 semantic entry, and it names the family\'s D2 conversion (ruled: a D3 entry per family, even beside a lossless D2)', () => {
    const semantic = MIGRATIONS_BY_MAJOR[18]!.semantic;
    const family = semantic.filter((s) => s.id === 'view-overlay-owner-hidden-retired');
    expect(family).toHaveLength(1);
    const entry = family[0]!;
    // Its door, its conversion, the measured zero and the unmeasured population.
    expect(entry.surface).toContain('flattened view overlay');
    expect(entry.reason).toContain('`view-overlay-owner-hidden-removed`');
    expect(entry.reason).toContain('Measured writers in this repository and its sibling UI: zero');
    expect(entry.reason).toContain('NOT MEASURED');
    expect(entry.acceptanceCriteria.length).toBeGreaterThan(0);
    // One family, one record. Another entry may NAME this conversion only as a
    // cross-reference that points at this record (the view item family's D3
    // entry does, to say the overlay pair is a separate family) — never as a
    // second record of its own.
    const naming = semantic.filter((s) => JSON.stringify(s).includes('view-overlay-owner-hidden-removed'));
    expect(naming.map((s) => s.id)).toContain('view-overlay-owner-hidden-retired');
    for (const other of naming.filter((s) => s.id !== 'view-overlay-owner-hidden-retired')) {
      expect(JSON.stringify(other), other.id).toContain('view-overlay-owner-hidden-retired');
    }
  });
});
