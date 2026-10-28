// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `FormView.type` is the form's LAYOUT only (#27155) — ADR-0050 Accepted by
 * ruling 6464210455 on #27032 (letter A′, maintainer 「其他同意」): `simple`,
 * `tabbed` and `wizard` stay; `drawer` and `modal` named where a form OPENS,
 * which is the caller's open mode; `split` was a list-beside-record view mode,
 * which #26804 had already made a reader's preference.
 *
 * Bookkeeping shapes, pinned below:
 *   1. `FormViewSchema.type` is `simple | tabbed | wizard`, default `simple`,
 *      and `split` / `drawer` / `modal` are refused by name with a
 *      prescription (`enumWithRetiredValues`) at every form-view door: the
 *      schema, a container's `form` / `formViews.*`, a ViewItem form record, a
 *      flattened form overlay, and `defineStack`.
 *   2. The split-only keys `sections[].pane` (and the legacy `groups[].pane`),
 *      `splitSize`, `splitResizable` and — since the renderer half, #27159 —
 *      `splitDirection` are `retiredKey()` tombstones, refused on every
 *      layout. `drawerSide`, `drawerWidth` and `modalSize` stay declared — a
 *      stated boundary, pinned as one.
 *   3. The `object-form` page block (#27159): `formType` drops `split` and
 *      keeps `drawer` / `modal` (the block renderer is the caller that opens
 *      those containers); its `splitDirection`, `splitSize`, `splitResizable`
 *      and `sections[].pane` are tombstones.
 *   4. One D2 conversion, retired from the load path:
 *      `form-view-presentation-types-removed` deletes a retired member (the
 *      form lands on `simple`) and strips the split keys from stored rows and
 *      existing sources, form views and `object-form` blocks alike; its D3
 *      entry is `ui-form-view-type-layout-only`.
 *   5. Tree-scoped absence: no form view inside the declared radius still
 *      authors a retired member, and nothing authors a `formType: 'split'`.
 *
 * On the assertion set: a schema refusal raises a `ZodError` whose issues carry
 * `code` and `path` but no ADR-0112 `status` (that envelope belongs to the
 * doors), so each schema refusal is pinned by the issue `code`, the `path` and
 * the prescription's first sentence; the `defineStack` door adds the envelope's
 * `code` + `status`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { listRepoWalkFiles } from '../../scripts/lib/repo-walk-testkit';
import { collectConversionNotices } from '../conversions/apply';
import { ALL_CONVERSIONS } from '../conversions/registry';
import { applyConversionsToStoredItem } from '../conversions/stored';
import type { ConversionNotice } from '../conversions/types';
import { MIGRATIONS_BY_MAJOR, RETIRED_KEYS_BY_MAJOR } from '../migrations/registry';
import { defineStack } from '../stack.zod';
import { ObjectFormPropsSchema } from './component.zod';
import { FormSectionSchema, FormViewSchema, VIEW_METADATA_MEMBERS, ViewItemSchema, ViewSchema } from './view.zod';

const CONVERSION_ID = 'form-view-presentation-types-removed';
const D3_ID = 'ui-form-view-type-layout-only';

/** Each retired `type` member → the first sentence of its prescription. */
const TYPE_FIRST_SENTENCE = {
  split:
    "'split' was removed from the form view `type` enum in @objectstack/spec 18.3.0 (ADR-0050) — `type` is the "
    + "form's layout, and a side-by-side split is not one: whether a record opens beside its list is each "
    + "reader's own preference in the list's Display menu, not metadata.",
  drawer:
    "'drawer' was removed from the form view `type` enum in @objectstack/spec 18.3.0 (ADR-0050) — `type` is the "
    + "form's layout, and where a form opens is decided by whoever opens it: a list opens a clicked record in "
    + "the drawer (`navigation.mode`, the default), and the console's New and Edit entries open the record form "
    + 'themselves.',
  modal:
    "'modal' was removed from the form view `type` enum in @objectstack/spec 18.3.0 (ADR-0050) — `type` is the "
    + "form's layout, and where a form opens is decided by whoever opens it: the console's New and Edit dialogs "
    + "open the record form themselves (sized by the form's `modalSize`), and an action `type: 'modal'` opens "
    + 'the page it targets.',
} as const;
/** Each tombstoned key → the first sentence of its prescription. */
const KEY_FIRST_SENTENCE = {
  pane:
    "`view.form.sections[].pane` was removed in @objectstack/spec 18.3.0 (ADR-0050) — it placed a section in one "
    + "pane of a `type: 'split'` form, and `split` left the form view `type` in the same release, so no form view "
    + 'draws panes.',
  splitSize:
    "`view.form.splitSize` was removed in @objectstack/spec 18.3.0 (ADR-0050) — it sized the primary pane of a "
    + "`type: 'split'` form, and `split` left the form view `type` in the same release, so no form view draws panes.",
  splitDirection:
    "`view.form.splitDirection` was removed in @objectstack/spec 18.3.0 (ADR-0050) — it set the pane orientation "
    + 'of a split form, and the split form renderer retired in the same release, so no form draws panes.',
  splitResizable:
    "`view.form.splitResizable` was removed in @objectstack/spec 18.3.0 (ADR-0050) — it made the panes of a "
    + "`type: 'split'` form resizable, and `split` left the form view `type` in the same release, so no form view "
    + 'draws panes.',
} as const;
const MIGRATE_SENTENCE = 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources;';

const RETIRED_TYPES = ['split', 'drawer', 'modal'] as const;
const LIVE_TYPES = ['simple', 'tabbed', 'wizard'] as const;

type Issue = { code: string; path: PropertyKey[]; message: string };
type Parse = { success: boolean; data?: unknown; error?: { issues: Issue[] } };
type Door = { name: string; parse: (form: Record<string, unknown>) => Parse; at: PropertyKey[] };

const SECTIONS = [{ label: 'Main', fields: ['name'] }];

/** Every door a form view payload is parsed through, with the path the payload sits at. */
const DOORS: readonly Door[] = [
  { name: 'FormViewSchema', parse: (f) => FormViewSchema.safeParse(f), at: [] },
  { name: 'view.form', parse: (f) => ViewSchema.safeParse({ form: f }), at: ['form'] },
  { name: 'view.formViews.*', parse: (f) => ViewSchema.safeParse({ formViews: { quick: f } }), at: ['formViews', 'quick'] },
  {
    name: 'ViewItem form record',
    parse: (f) => ViewItemSchema.safeParse({ name: 'crm_lead.quick', object: 'crm_lead', viewKind: 'form', config: f }),
    at: ['config'],
  },
  {
    name: 'flattened form overlay',
    parse: (f) => VIEW_METADATA_MEMBERS.formOverlay.safeParse({ ...f, object: 'crm_lead', viewKind: 'form' }),
    at: [],
  },
];

/** The issues a door reports under the payload — a wrapper may report others of its own. */
const payloadIssues = (r: Parse, door: Door) =>
  (r.error?.issues ?? []).filter((i) => door.at.every((seg, k) => i.path[k] === seg));

describe('FormView.type — `simple | tabbed | wizard`, default `simple`', () => {
  it('the vocabulary is exactly the three layouts, simple first', () => {
    const typeSchema = FormViewSchema.shape.type as unknown as { unwrap: () => { options: readonly string[] } };
    expect(typeSchema.unwrap().options).toEqual([...LIVE_TYPES]);
    expect(FormViewSchema.parse({ sections: SECTIONS }).type).toBe('simple');
  });

  it.each(DOORS.map((d) => [d.name, d] as const))('%s refuses each retired member at `type`, with its prescription', (_, door) => {
    for (const type of RETIRED_TYPES) {
      const r = door.parse({ type, sections: SECTIONS });
      expect(r.success, type).toBe(false);
      const issues = payloadIssues(r, door);
      expect(issues, `${type}: ${JSON.stringify(issues)}`).toHaveLength(1);
      expect(issues[0]!.code).toBe('invalid_value');
      expect(issues[0]!.path).toEqual([...door.at, 'type']);
      expect(issues[0]!.message.startsWith(TYPE_FIRST_SENTENCE[type]), issues[0]!.message).toBe(true);
      expect(issues[0]!.message).toContain(MIGRATE_SENTENCE);
    }
  });

  it.each(DOORS.map((d) => [d.name, d] as const))('%s accepts each live layout', (_, door) => {
    for (const type of LIVE_TYPES) {
      expect(door.parse({ type, sections: SECTIONS }).success, type).toBe(true);
    }
  });

  it('CONTROL: a misspelt member keeps zod\'s own message — "was removed" would misinform', () => {
    const r = FormViewSchema.safeParse({ type: 'tabed', sections: SECTIONS });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.code).toBe('invalid_value');
    expect(r.error!.issues[0]!.message).not.toContain('was removed');
  });

  it('defineStack refuses a retired member with the ADR-0112 envelope and the prescription', () => {
    for (const type of RETIRED_TYPES) {
      let refusal: unknown;
      try {
        defineStack({ views: [{ object: 'crm_lead', formViews: { quick: { type, sections: SECTIONS } } }] } as never);
      } catch (error) {
        refusal = error;
      }
      expect(refusal, type).toMatchObject({ code: 'STACK_SCHEMA_INVALID', status: 422 });
      const issues = (refusal as { issues: { path: PropertyKey[]; message: string }[] }).issues;
      expect(issues.map((i) => i.path.join('.'))).toEqual(['views.0.formViews.quick.type']);
      expect(issues[0]!.message.startsWith(TYPE_FIRST_SENTENCE[type])).toBe(true);
    }
    for (const type of LIVE_TYPES) {
      const sections = [{ label: 'Step', fields: ['name'] }];
      expect(() => defineStack({ views: [{ object: 'crm_lead', formViews: { quick: { type, sections } } }] } as never)).not.toThrow();
    }
  });

  it('fails tsc at the authoring site: a retired member is not in the input type', () => {
    const form: z.input<typeof FormViewSchema> = {
      // @ts-expect-error — `modal` left `FormViewSchema.type`; only the three layouts type-check.
      type: 'modal',
      sections: SECTIONS,
    };
    expect(FormViewSchema.safeParse(form).success).toBe(false);
  });
});

describe('the split-only keys — `pane`, `splitSize`, `splitResizable`, `splitDirection` — are tombstones on every layout', () => {
  it.each(LIVE_TYPES)('`pane` is refused with its prescription on a %s form, in `sections` and in the legacy `groups`', (type) => {
    for (const bucket of ['sections', 'groups'] as const) {
      const r = FormViewSchema.safeParse({ type, [bucket]: [{ label: 'Main', pane: 'primary', fields: ['name'] }] }) as Parse;
      expect(r.success, bucket).toBe(false);
      const issues = r.error!.issues.filter((i) => i.path.join('.') === `${bucket}.0.pane`);
      expect(issues, bucket).toHaveLength(1);
      expect(issues[0]!.message.startsWith(KEY_FIRST_SENTENCE.pane), issues[0]!.message).toBe(true);
      expect(issues[0]!.message).toContain(MIGRATE_SENTENCE);
    }
  });

  it('`pane` is refused at the section shape itself, whatever value it carries', () => {
    for (const pane of ['primary', 'secondary', 'left']) {
      const r = FormSectionSchema.safeParse({ label: 'Main', pane, fields: ['name'] }) as Parse;
      expect(r.success, pane).toBe(false);
      expect(r.error!.issues.map((i) => i.path.join('.'))).toEqual(['pane']);
      expect(r.error!.issues[0]!.message.startsWith(KEY_FIRST_SENTENCE.pane)).toBe(true);
    }
  });

  it.each(['splitSize', 'splitResizable', 'splitDirection'] as const)('`%s` is refused with its prescription', (key) => {
    const value = { splitSize: 40, splitResizable: true, splitDirection: 'vertical' }[key];
    for (const type of LIVE_TYPES) {
      const r = FormViewSchema.safeParse({ type, sections: SECTIONS, [key]: value }) as Parse;
      expect(r.success, type).toBe(false);
      expect(r.error!.issues.map((i) => i.path.join('.'))).toEqual([key]);
      expect(r.error!.issues[0]!.message.startsWith(KEY_FIRST_SENTENCE[key]), r.error!.issues[0]!.message).toBe(true);
      expect(r.error!.issues[0]!.message).toContain(MIGRATE_SENTENCE);
    }
  });

  it('the four keys are registered in RETIRED_KEYS_BY_MAJOR[18] under their exact def keys', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toEqual(expect.arrayContaining([
      'ui/FormSection:pane',
      'ui/FormView:splitSize',
      'ui/FormView:splitResizable',
      'ui/FormView:splitDirection',
    ]));
  });

  it('STATED BOUNDARY: `drawerSide`, `drawerWidth` and `modalSize` stay declared', () => {
    // `modalSize` is read by the console's record dialog on every layout; the
    // other two feed the React `ObjectForm` block contract (`react-blocks.ts`),
    // whose `formType='drawer'` container still reads them (#27153 keeps their
    // enforce-or-remove question for form views).
    const r = FormViewSchema.safeParse({
      type: 'simple',
      sections: SECTIONS,
      drawerSide: 'left',
      drawerWidth: '480px',
      modalSize: 'lg',
    });
    expect(r.success).toBe(true);
  });

  it('fails tsc at the authoring site: the tombstoned keys admit only absence', () => {
    const form: z.input<typeof FormViewSchema> = {
      type: 'tabbed',
      // @ts-expect-error — `splitSize` is a `retiredKey()` tombstone, typed `never`.
      splitSize: 40,
      // @ts-expect-error — `pane` is a `retiredKey()` tombstone, typed `never`.
      sections: [{ label: 'Main', pane: 'primary', fields: ['name'] }],
    };
    expect(FormViewSchema.safeParse(form).success).toBe(false);
  });
});

type Notice = Pick<ConversionNotice, 'conversionId' | 'path' | 'from' | 'to'>;
const brief = (n: ConversionNotice): Notice => ({ conversionId: n.conversionId, path: n.path, from: n.from, to: n.to });
const ours = (n: ConversionNotice) => n.conversionId === CONVERSION_ID;

/** The `object-form` block's prescriptions (#27159) → their first sentences. */
const BLOCK_SPLIT_FIRST_SENTENCE =
  "'split' was removed from the `object-form` `formType` enum in @objectstack/spec 18.3.0 (ADR-0050) — the split "
  + 'form renderer retired with it, so nothing draws two panes:';
const blockKeyFirstSentence = (key: string, what: string) =>
  `\`object-form\` property \`${key}\` was removed in @objectstack/spec 18.3.0 (ADR-0050) — it ${what} of a `
  + "`formType: 'split'` form, and `split` left the block in the same release, so no form draws panes.";
const BLOCK_KEYS = {
  splitDirection: ['set the pane orientation', 'vertical'],
  splitSize: ['sized the primary pane', 40],
  splitResizable: ['made the panes resizable', true],
} as const;
const BLOCK = { objectName: 'crm_contact' };

describe('the `object-form` block — `split` leaves `formType`, `drawer` / `modal` stay (#27159)', () => {
  it('the vocabulary is the three layouts plus the two containers the block opens', () => {
    const formType = ObjectFormPropsSchema.shape.formType as unknown as { unwrap: () => { options: readonly string[] } };
    expect(formType.unwrap().options).toEqual(['simple', 'tabbed', 'wizard', 'drawer', 'modal']);
  });

  it("refuses `formType: 'split'` by name, with its prescription", () => {
    const r = ObjectFormPropsSchema.safeParse({ ...BLOCK, formType: 'split' }) as Parse;
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.path.join('.'))).toEqual(['formType']);
    expect(r.error!.issues[0]!.code).toBe('invalid_value');
    expect(r.error!.issues[0]!.message.startsWith(BLOCK_SPLIT_FIRST_SENTENCE), r.error!.issues[0]!.message).toBe(true);
    expect(r.error!.issues[0]!.message).toContain('object-master-detail-form');
    expect(r.error!.issues[0]!.message).toContain(MIGRATE_SENTENCE);
  });

  it('CONTROL: `drawer` and `modal` still parse on the block, with the keys their containers read', () => {
    expect(ObjectFormPropsSchema.safeParse({ ...BLOCK, formType: 'drawer', drawerSide: 'left', drawerWidth: '480px' }).success).toBe(true);
    expect(ObjectFormPropsSchema.safeParse({ ...BLOCK, formType: 'modal', modalSize: 'lg', modalCloseButton: false }).success).toBe(true);
    for (const formType of LIVE_TYPES) {
      expect(ObjectFormPropsSchema.safeParse({ ...BLOCK, formType }).success, formType).toBe(true);
    }
  });

  it.each(Object.keys(BLOCK_KEYS) as (keyof typeof BLOCK_KEYS)[])('`%s` is a tombstone on the block, whatever its `formType`', (key) => {
    const [what, value] = BLOCK_KEYS[key];
    for (const formType of ['simple', 'tabbed', 'drawer', 'modal'] as const) {
      const r = ObjectFormPropsSchema.safeParse({ ...BLOCK, formType, [key]: value }) as Parse;
      expect(r.success, formType).toBe(false);
      expect(r.error!.issues.map((i) => i.path.join('.'))).toEqual([key]);
      expect(r.error!.issues[0]!.message.startsWith(blockKeyFirstSentence(key, what)), r.error!.issues[0]!.message).toBe(true);
      expect(r.error!.issues[0]!.message).toContain(MIGRATE_SENTENCE);
    }
  });

  it('a section `pane` is a tombstone on the block', () => {
    const r = ObjectFormPropsSchema.safeParse({ ...BLOCK, formType: 'tabbed', sections: [{ label: 'Main', pane: 'primary', fields: ['name'] }] }) as Parse;
    expect(r.success).toBe(false);
    const issues = r.error!.issues.filter((i) => i.path.join('.') === 'sections.0.pane');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message.startsWith(
      "`object-form` property `sections[].pane` was removed in @objectstack/spec 18.3.0 (ADR-0050) — it placed a "
      + "section in one pane of a `formType: 'split'` form",
    ), issues[0]!.message).toBe(true);
  });

  it('the three block keys are registered in RETIRED_KEYS_BY_MAJOR[18]', () => {
    expect(RETIRED_KEYS_BY_MAJOR[18]).toEqual(expect.arrayContaining([
      'ui/ObjectFormProps:splitDirection',
      'ui/ObjectFormProps:splitSize',
      'ui/ObjectFormProps:splitResizable',
    ]));
  });

  it('fails tsc at the authoring site: `split` and the split keys are not in the block input type', () => {
    const props: z.input<typeof ObjectFormPropsSchema> = {
      ...BLOCK,
      // @ts-expect-error — `split` left the block's `formType`.
      formType: 'split',
      // @ts-expect-error — `splitSize` is a `retiredKey()` tombstone, typed `never`.
      splitSize: 40,
    };
    expect(ObjectFormPropsSchema.safeParse(props).success).toBe(false);
  });

  it('a STORED page converts its `object-form` blocks: `split` and the split keys go, `drawer` stays', () => {
    const row = {
      name: 'desk',
      regions: [{
        name: 'main',
        components: [
          { type: 'object-form', properties: { ...BLOCK, formType: 'split', splitDirection: 'vertical', sections: [{ label: 'A', pane: 'primary', fields: ['name'] }] } },
          { type: 'object-form', properties: { ...BLOCK, formType: 'drawer', drawerSide: 'left' } },
        ],
      }],
    };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('page', row, { onNotice: (n) => notices.push(n) }) as typeof row;
    expect(notices.filter(ours).map((n) => [n.from, n.path.replace(/^.*?properties/, 'properties')])).toEqual([
      ['split', 'properties.formType'],
      ['splitDirection', 'properties.splitDirection'],
      ['pane', 'properties.sections[0].pane'],
    ]);
    expect(out.regions[0]!.components[0]!.properties).toEqual({ ...BLOCK, sections: [{ label: 'A', fields: ['name'] }] });
    expect(out.regions[0]!.components[1]).toBe(row.regions[0]!.components[1]);
    expect(ObjectFormPropsSchema.safeParse(out.regions[0]!.components[0]!.properties).success).toBe(true);
  });
});


describe(`the D2 conversion ${CONVERSION_ID}`, () => {
  it('a STORED view container replays to a body the strict door accepts, landing on `simple`', () => {
    const row = {
      object: 'crm_lead',
      form: { type: 'tabbed', sections: [{ label: 'Main', fields: ['name'] }] },
      formViews: {
        beside: {
          type: 'split',
          splitSize: 40,
          splitDirection: 'vertical',
          sections: [{ label: 'A', pane: 'primary', fields: ['name'] }, { label: 'B', pane: 'secondary', fields: ['email'] }],
        },
        quick: { type: 'drawer', drawerSide: 'left', sections: [{ label: 'Q', fields: ['status'] }] },
      },
    };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('view', row, { onNotice: (n) => notices.push(n) }) as typeof row;
    expect(notices.filter(ours).map(brief)).toEqual([
      { conversionId: CONVERSION_ID, path: 'views[0].formViews.beside.type', from: 'split', to: '(removed)' },
      { conversionId: CONVERSION_ID, path: 'views[0].formViews.beside.splitDirection', from: 'splitDirection', to: '(removed)' },
      { conversionId: CONVERSION_ID, path: 'views[0].formViews.beside.splitSize', from: 'splitSize', to: '(removed)' },
      { conversionId: CONVERSION_ID, path: 'views[0].formViews.beside.sections[0].pane', from: 'pane', to: '(removed)' },
      { conversionId: CONVERSION_ID, path: 'views[0].formViews.beside.sections[1].pane', from: 'pane', to: '(removed)' },
      { conversionId: CONVERSION_ID, path: 'views[0].formViews.quick.type', from: 'drawer', to: '(removed)' },
    ]);
    const parsed = ViewSchema.parse(out);
    expect(parsed.formViews?.beside?.type).toBe('simple');
    expect(parsed.formViews?.beside).not.toHaveProperty('splitDirection');
    expect(parsed.formViews?.quick?.type).toBe('simple');
    expect(parsed.formViews?.quick?.drawerSide).toBe('left');
    // A live layout is the author's and is never touched.
    expect(out.form).toBe(row.form);
    // Copy-on-write: the stored row is not mutated.
    expect(row.formViews.beside).toHaveProperty('type', 'split');
  });

  it('a STORED form view item record converts its `config`', () => {
    const row = { name: 'crm_lead.peek', object: 'crm_lead', viewKind: 'form', config: { type: 'modal', modalSize: 'lg', sections: SECTIONS } };
    const notices: ConversionNotice[] = [];
    const out = applyConversionsToStoredItem('view', row, { onNotice: (n) => notices.push(n) }) as typeof row;
    expect(notices.filter(ours).map((n) => n.path)).toEqual(['views[0].config.type']);
    expect(out.config).toEqual({ modalSize: 'lg', sections: SECTIONS });
    expect(ViewItemSchema.safeParse(out).success).toBe(true);
  });

  it('is idempotent by construction: a second replay converts nothing', () => {
    const { stack } = collectConversionNotices(
      { views: [{ object: 'o', form: { type: 'split', splitResizable: true, sections: [{ label: 'A', pane: 'primary', fields: ['a'] }] } }] },
      { includeRetired: true },
    );
    const replay = collectConversionNotices(stack, { includeRetired: true });
    expect(replay.notices.filter(ours)).toEqual([]);
    expect(replay.stack).toBe(stack);
  });

  it('is retired from the load path — the authoring funnel rewrites no live source', () => {
    const input = { views: [{ object: 'o', form: { type: 'modal', sections: SECTIONS } }] };
    const { stack, notices } = collectConversionNotices(input);
    expect(notices.filter(ours)).toEqual([]);
    expect(stack).toEqual(input);
  });

  it('is wired into the step-18 chain as a retired entry stamped after 18.2.0', () => {
    expect(MIGRATIONS_BY_MAJOR[18]!.conversionIds).toContain(CONVERSION_ID);
    const conversion = ALL_CONVERSIONS.find((c) => c.id === CONVERSION_ID);
    expect(conversion).toBeDefined();
    expect(conversion!.toMajor).toBe(18);
    expect(conversion!.retiredFromLoadPath).toBe(true);
    expect(conversion!.retiredAfter).toBe('18.2.0');
  });

  it(`carries the D3 entry ${D3_ID}, naming its D2 conversion`, () => {
    const entries = MIGRATIONS_BY_MAJOR[18]!.semantic.filter((s) => s.id === D3_ID);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.reason).toContain(`\`${CONVERSION_ID}\``);
    expect(entries[0]!.conversionIds).toEqual([CONVERSION_ID]);
    expect(entries[0]!.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

// ─── Tree-scoped absence, inside the radius the package already declares ───
//
// `tsc` sweeps the TYPED authoring sites (every example app is a workspace
// package with its own `typecheck`); this walk covers every text file under the
// five repo roots `scripts/cross-package-test-inputs.mjs` declares for
// `@objectstack/spec#test` (mirrored in `turbo.json`), with the example apps'
// own `src/` trees. It judges the AUTHORING SHAPE of a FORM VIEW: a `form`
// object literal whose own braces hold a retired `type`, a `formViews` entry
// whose own braces do, and an object literal naming `viewKind: 'form'` beside
// one, and — since #27159 — any `formType: 'split'`: `split` left the
// `object-form` block and the `object-master-detail-form` block alike, so no
// `formType` anywhere admits it. The bound, stated: `type: 'modal'` on its own
// is an ACTION type, and `formType: 'drawer' | 'modal'` is a live `object-form`
// container, so neither is judged bare; the bare keys `pane`, `splitDirection`,
// `splitSize` and `splitResizable` are not judged either — a key name alone is
// too generic to read as a form's, and each tombstone refuses it at parse. A form view assembled by spread or a computed key, YAML, and
// the console under `ui/` (outside this radius) are outside what this walk sees.
describe('tree-scoped absence: nothing inside the declared radius still authors a retired form view type or `formType: \'split\'`', () => {
  const SPEC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const REPO_ROOT = path.resolve(SPEC_ROOT, '../..');
  const THIS_FILE = path.relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join('/');

  const WALK_ROOTS = ['packages', 'examples', 'skills', 'content', 'scripts'];
  const SCANNED_EXT = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.md', '.mdx']);
  const EXAMPLES_EXT = new Set(['.json', '.md', '.mdx']);
  const EXAMPLE_APP_SRC_TS = /^examples\/[^/]+\/src\/.+\.ts$/;
  const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.turbo', '.cache', '.objectstack', 'coverage', '.next', '.source']);

  const RETIRED = String.raw`["']?type["']?\s*:\s*["'](?:split|drawer|modal)["']`;
  /** A `formType` naming the retired `split` — no block admits it (#27159). */
  const FORM_TYPE_SPLIT = /["']?\bformType["']?\s*:\s*["']split["']/;
  /** A `form` slot whose own braces hold a retired `type`. */
  const FORM_SLOT = new RegExp(String.raw`["']?\bform["']?\s*:\s*\{[^{}]*?` + RETIRED);
  /** An object literal naming `viewKind: 'form'` with a retired `type` in the same braces. */
  const FORM_ITEM = [
    new RegExp(String.raw`\{[^{}]*?["']?viewKind["']?\s*:\s*["']form["'][^{}]*?` + RETIRED),
    new RegExp(String.raw`\{[^{}]*?` + RETIRED + String.raw`[^{}]*?["']?viewKind["']?\s*:\s*["']form["']`),
  ];
  /** A retired `type` directly inside one entry of a `formViews` record. */
  const formViewsEntries = (text: string): boolean => {
    const opener = /["']?formViews["']?\s*:\s*\{/g;
    for (let m = opener.exec(text); m; m = opener.exec(text)) {
      // Walk the record's braces; depth 1 is an entry's own body.
      let depth = 0;
      let entryStart = -1;
      for (let i = m.index + m[0].length - 1; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === '{') {
          depth += 1;
          if (depth === 2) entryStart = i;
        } else if (ch === '}') {
          if (depth === 2 && entryStart >= 0) {
            const body = text.slice(entryStart, i + 1);
            if (new RegExp(String.raw`^\{[^{}]*?` + RETIRED).test(body)) return true;
          }
          depth -= 1;
          if (depth === 0) break;
        }
      }
    }
    return false;
  };
  /** Inline code spans are prose; newline-bounded, so a fenced example is still judged. */
  const stripInlineCode = (text: string): string => text.replace(/`[^`\n]*`/g, '');
  const judge = (raw: string): boolean => {
    const text = stripInlineCode(raw);
    return FORM_SLOT.test(text) || FORM_TYPE_SPLIT.test(text) || FORM_ITEM.some((re) => re.test(text)) || formViewsEntries(text);
  };

  /**
   * Structural exclusions — the retirement kit, each with its reason. ⛔ NOT an
   * allowlist file (`spec-property-retirement` §4): every entry's JOB is to
   * spell the retired members.
   */
  const EXCLUDED = new Set([
    // This pin authors the members to assert their refusal and their conversion.
    THIS_FILE,
    // The removal-version pin parses each retired member to read its prescription.
    'packages/spec/src/shared/retired-key-removal-version.pin.test.ts',
  ]);
  const EXCLUDED_PREFIXES = [
    // The D2 conversion's fixture authors the pre-retirement forms on purpose.
    'packages/spec/src/conversions/',
    // Release-owned prose records the removal; never edited by a code PR.
    'content/docs/releases/',
  ];
  const TSUP_BUNDLED_CONFIG = /\.bundled_[^./]+\.mjs$/;

  const readIfPresent = (full: string): string | undefined => {
    try {
      return fs.readFileSync(full, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
      return undefined;
    }
  };

  it('the matcher recognises an authoring and ignores its neighbours (anti-vacuity)', () => {
    expect(judge("form: { type: 'modal', sections: [] },")).toBe(true);
    expect(judge("formViews: {\n  quick: {\n    type: 'drawer',\n    data,\n  },\n},")).toBe(true);
    expect(judge("formViews: { tabbed: { type: 'tabbed' }, beside: { type: 'split', sections: [] } }")).toBe(true);
    expect(judge('{ "name": "crm_lead.peek", "viewKind": "form", "type": "modal" }')).toBe(true);
    expect(judge("{ type: 'split', object: 'crm_lead', viewKind: 'form' }")).toBe(true);
    expect(judge("Prose.\n\n```ts\nform: { type: 'split' }\n```\n")).toBe(true);
    expect(judge("properties: { formType: 'split', objectName: 'crm_lead' }")).toBe(true);
    expect(judge('{ "type": "object-form", "properties": { "formType": "split" } }')).toBe(true);
    // Neighbours that must NOT match.
    expect(judge("form: { type: 'tabbed', sections: [] },")).toBe(false);
    expect(judge("{ name: 'open_detail', type: 'modal', target: 'detail_page' }")).toBe(false);
    expect(judge("properties: { formType: 'drawer', objectName: 'crm_lead' }")).toBe(false);
    expect(judge("formViews: { quick: { type: 'simple', sections: [{ fields: [{ field: 'a', type: 'modal' }] }] } }")).toBe(false);
    expect(judge("{ viewKind: 'list', type: 'split' }")).toBe(false);
    expect(judge("a form once wrote `form: { type: 'modal' }`.")).toBe(false);
    expect(judge("a block once wrote `formType: 'split'`.")).toBe(false);
  });

  it('no form view authoring a retired member survives inside the declared radius', () => {
    const offenders: string[] = [];
    let visited = 0;
    let mentioning = 0;
    const skipDir = (name: string) => SKIPPED_DIRS.has(name) || name.startsWith('.');
    for (const root of WALK_ROOTS) {
      for (const full of listRepoWalkFiles(path.join(REPO_ROOT, root), { skipDir })) {
        const rel = path.relative(REPO_ROOT, full).split(path.sep).join('/');
        const name = path.basename(full);
        const ext = path.extname(name);
        const scanned = rel.startsWith('examples/')
          ? EXAMPLES_EXT.has(ext) || EXAMPLE_APP_SRC_TS.test(rel)
          : SCANNED_EXT.has(ext);
        if (!scanned) continue;
        if (name === 'CHANGELOG.md') continue; // release prose records the removal
        if (EXCLUDED.has(rel) || EXCLUDED_PREFIXES.some((p) => rel.startsWith(p))) continue;
        if (TSUP_BUNDLED_CONFIG.test(name)) continue;
        visited += 1;
        const text = readIfPresent(full);
        if (text === undefined) continue;
        if (/["']?formViews["']?\s*:\s*\{/.test(text)) mentioning += 1;
        if (judge(text)) offenders.push(rel);
      }
    }
    // Anti-vacuity: the walk covered the tree, and files that DO author form
    // views were really judged.
    expect(visited).toBeGreaterThan(1000);
    expect(mentioning).toBeGreaterThan(5);
    expect(offenders, 'a form view authoring a retired type means the retirement is being undone').toEqual([]);
  });
});
