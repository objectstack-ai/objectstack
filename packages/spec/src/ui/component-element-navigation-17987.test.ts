// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17987] Record-click navigation on the STANDALONE element faces — the spec
 * half of the objectui#8652 maintainer ruling (four options were put; the reply
 * was verbatim `B`: declare `navigation` on the platform element schemas).
 *
 * ## What was wrong
 *
 * `ComponentPropsMap` refused `navigation` BY NAME on `object-kanban` and
 * `object-calendar` — through the generic `unrecognized_keys` rule, the same
 * verdict a typo gets — while objectui's renderers read and honour the key on a
 * standalone node with no view ancestor to resolve a mode from. The same
 * document ran correctly in the renderer and failed at the authoring door, and
 * neither face taught the author the truth. `object-timeline` was worse off
 * still: no row at all, so the #5068 props gate skipped it and a real key and a
 * typo rode through alike.
 *
 * ⚠️ The view-level `navigation` on `ListViewSchema` is NOT retired or changed
 * by this card — the element key is an ADDITIONAL carrier for the standalone
 * placement. The last describe below is that half, pinned so a later sweep
 * cannot fold the two into one question.
 *
 * ## What each block below buys, and why the controls are not decoration
 *
 * A face that accepted `navigation` because it accepted EVERYTHING would pass
 * the first block and mean nothing, so every acceptance here is paired with a
 * bogus key refused through `unrecognized_keys` on the same face in the same
 * run. The second block is the ruling's "cannot fork" clause with teeth: the
 * carrier is asserted to be the view face's own def — by reference AND by a
 * shared accept/refuse battery — so an element-local copy of the shape, the one
 * outcome the ruling rules out, fails here rather than drifting for a release.
 */
import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import { ComponentPropsMap } from './component.zod';
import { ListViewSchema, TimelineConfigSchema } from './view.zod';

/** The three element faces the ruling names, in the order objectui#8652 lists them. */
const FACES: ReadonlyArray<{ type: string; schema: z.ZodType }> = [
  { type: 'object-kanban', schema: ComponentPropsMap['object-kanban'] },
  { type: 'object-timeline', schema: ComponentPropsMap['object-timeline'] },
  { type: 'object-calendar', schema: ComponentPropsMap['object-calendar'] },
];

/**
 * The refused control key, spelled so no edit-distance suggestion can reach a
 * declared key and answer it — a near-miss would refuse for a second reason and
 * stop discriminating.
 */
const BOGUS_KEY = 'zzzDefinitelyNotAKey';

/** A minimal list view that parses clean apart from whatever a case adds. */
const baseView = (extra: Record<string, unknown>) => ({
  type: 'grid' as const,
  name: 'my_list',
  columns: ['subject'],
  ...extra,
});

/**
 * The schema a door on `schema` resolves to, with the `.optional()` wrapper
 * peeled — the comparable half of two declarations that both go through
 * `lazySchema`.
 */
function innerOf(schema: unknown, key: string): unknown {
  const shape = (schema as { shape?: Record<string, { def?: { innerType?: unknown } }> }).shape;
  const door = shape?.[key];
  return door?.def?.innerType ?? door;
}

/** Issue codes of a failed parse, in declaration order. */
function codesOf(result: z.ZodSafeParseResult<unknown>): string[] {
  return result.success ? [] : result.error.issues.map((i) => i.code);
}

/** The message of the one `unrecognized_keys` issue a refusal carries. */
function unknownKeyMessage(result: z.ZodSafeParseResult<unknown>): string {
  expect(result.success).toBe(false);
  const issue = result.success ? undefined : result.error.issues.find((i) => i.code === 'unrecognized_keys');
  expect(issue).toBeDefined();
  return String(issue?.message ?? '');
}

describe('[#17987] the standalone element faces declare `navigation`', () => {
  it('each of the three accepts the card\'s acceptance document', () => {
    for (const { type, schema } of FACES) {
      const r = schema.safeParse({ objectName: 'task', navigation: { mode: 'drawer' } });
      expect(r.success, `${type} refused \`navigation\`: ${JSON.stringify(codesOf(r))}`).toBe(true);
      // The parsed state is the view face's: the four defaulted members
      // materialize, and `mode` is the one the author wrote.
      expect((r.success ? r.data : {}) as Record<string, unknown>).toMatchObject({
        navigation: { mode: 'drawer', preventNavigation: false, openNewTab: false, size: 'auto' },
      });
    }
  });

  /**
   * The discriminating control. Without it a green above is equally consistent
   * with "this face accepts everything", which is the state `object-timeline`
   * was in before the row landed — and the whole defect class this card closes.
   */
  it('and each still refuses an undeclared key through `unrecognized_keys`', () => {
    for (const { type, schema } of FACES) {
      const r = schema.safeParse({ objectName: 'task', [BOGUS_KEY]: 1 });
      expect(r.success, `${type} accepted the bogus control key`).toBe(false);
      expect(codesOf(r), type).toContain('unrecognized_keys');
      expect(unknownKeyMessage(r), type).toContain(BOGUS_KEY);
    }
  });

  it('the key is optional with no default — an unauthored board carries none', () => {
    for (const { type, schema } of FACES) {
      const r = schema.safeParse({ objectName: 'task' });
      expect(r.success, type).toBe(true);
      expect(Object.keys((r.success ? r.data : {}) as Record<string, unknown>), type).not.toContain('navigation');
    }
  });

  it('`ComponentPropsMap[\'object-timeline\']` is defined — with a firing control for the zero', () => {
    expect(ComponentPropsMap['object-timeline']).toBeDefined();
    expect(Object.keys(ComponentPropsMap)).toContain('object-timeline');
    // Firing control: the one object-bound block this map deliberately does NOT
    // carry a row for (its key set is not derivable — see component.zod.ts).
    // Without it, "toContain" could be reading a map that contains everything.
    expect(Object.keys(ComponentPropsMap)).not.toContain('object-chart');
    expect((ComponentPropsMap as Record<string, unknown>)['object-chart']).toBeUndefined();
  });
});

describe('[#17987] the element carrier is the view face\'s def, not a second dialect', () => {
  it('is the very object `ListViewSchema.navigation` carries, on all three faces', () => {
    // Resolved through the doors themselves rather than through the exported
    // symbol: `lazySchema` hands back a lazy proxy until something touches it,
    // so the exported name and a resolved inner type are not the same object
    // even when there is only ONE shape. What the ruling forbids is a SECOND
    // shape, and that is a question about the two doors.
    const viewInner = innerOf(ListViewSchema, 'navigation');
    expect(viewInner, 'the view face declares no `navigation` door').toBeDefined();
    // Control: the resolved object really is the navigation block, so the
    // identity below cannot be two `undefined`s agreeing.
    expect(Object.keys((viewInner as { shape: Record<string, unknown> }).shape)).toContain('mode');
    for (const { type, schema } of FACES) {
      const elementInner = innerOf(schema, 'navigation');
      expect(elementInner, `${type} declares no \`navigation\` door`).toBeDefined();
      expect(elementInner, `${type} carries a COPY of the navigation shape`).toBe(viewInner);
    }
  });

  /**
   * The behavioural half of the same claim: reference identity could be
   * satisfied by a def nobody parses through, so the accept/refuse verdict is
   * asserted EQUAL to the view face's on the same five documents.
   */
  it('judges the value exactly as `ListViewSchema.navigation` does', () => {
    const CASES: ReadonlyArray<{ label: string; navigation: unknown }> = [
      { label: 'the drawer mode', navigation: { mode: 'drawer' } },
      { label: 'the new-window mode', navigation: { mode: 'new_window' } },
      { label: 'a mis-typed mode', navigation: { mode: 'drawr' } },
      { label: 'a bare string instead of the block', navigation: 'drawer' },
      { label: 'an undeclared member inside the block', navigation: { mode: 'drawer', zzzNotAMember: 1 } },
    ];
    // The battery must contain BOTH verdicts, or "equal to the view face" would
    // hold vacuously over five accepts.
    const viewVerdicts = CASES.map((c) => ListViewSchema.safeParse(baseView({ navigation: c.navigation })).success);
    expect(viewVerdicts).toContain(true);
    expect(viewVerdicts).toContain(false);

    CASES.forEach((c, i) => {
      for (const { type, schema } of FACES) {
        const el = schema.safeParse({ objectName: 'task', navigation: c.navigation });
        expect(el.success, `${type} disagrees with the view face on ${c.label}`).toBe(viewVerdicts[i]);
      }
    });
  });

  /**
   * The #16885 retirement rides along, which is the point of taking the def
   * rather than copying its live members: a second shape would have had to
   * carry the tombstone too, and would not have.
   */
  it('carries the retired `navigation.view` tombstone onto the element faces', () => {
    for (const { type, schema } of FACES) {
      const r = schema.safeParse({ objectName: 'task', navigation: { view: 'contact_form' } });
      expect(r.success, type).toBe(false);
      const messages = (r.success ? [] : r.error.issues).map((i) => i.message).join(' | ');
      expect(messages, type).toContain('was removed in @objectstack/spec 17.5.0');
    }
  });
});

describe('[#17987] the VIEW-level carrier is untouched', () => {
  it('`ListViewSchema` still accepts `navigation`, and still refuses a bogus key', () => {
    const ok = ListViewSchema.safeParse(baseView({ navigation: { mode: 'drawer' } }));
    expect(ok.success).toBe(true);
    const bogus = ListViewSchema.safeParse(baseView({ [BOGUS_KEY]: 1 }));
    expect(bogus.success).toBe(false);
    expect(codesOf(bogus)).toContain('unrecognized_keys');
  });
});

describe('[#17987] the `object-timeline` row judges the block in BOTH directions', () => {
  const TIMELINE = ComponentPropsMap['object-timeline'];

  it('accepts the key set measured from the renderer at the `.objectui-sha` pin', () => {
    const r = TIMELINE.safeParse({
      objectName: 'task',
      timeline: { startDateField: 'start_at', endDateField: 'end_at', titleField: 'subject', colorField: 'status' },
      filter: [{ field: 'status', operator: 'eq', value: 'open' }],
      sort: [{ field: 'start_at', order: 'desc' }],
      limit: 250,
      items: [{ title: 'Kickoff', time: '2026-01-15' }],
      variant: 'vertical',
      dateFormat: 'long',
      rowLabel: 'Teams',
      minDate: '2026-01-01',
      maxDate: '2026-12-31',
      descriptionField: 'notes',
      mapping: { title: 'subject', variant: 'status' },
      navigation: { mode: 'drawer' },
    });
    expect(r.success, JSON.stringify(codesOf(r))).toBe(true);
  });

  it('refuses the flat handoff spellings, and the prescription names the `timeline` block', () => {
    for (const flat of ['startDateField', 'titleField', 'endDateField', 'groupByField', 'colorField', 'scale', 'dateField']) {
      const r = TIMELINE.safeParse({ objectName: 'task', [flat]: 'x' });
      expect(r.success, `\`${flat}\` was accepted flat`).toBe(false);
      const message = unknownKeyMessage(r);
      expect(message, flat).toContain(flat);
      expect(message, flat).toContain('`timeline` config object');
    }
  });

  /**
   * The #17054 discipline, applied before it can be paid for twice: a
   * prescription that names a key the target schema refuses sends the author
   * from one refusal to a second one with a different message. Every block key
   * the prescription above names is asserted acceptable to
   * `TimelineConfigSchema` — the schema an author lands on when they follow it.
   */
  it('every key that prescription names is one `TimelineConfigSchema` accepts', () => {
    const prescribed = {
      startDateField: 'start_at',
      endDateField: 'end_at',
      titleField: 'subject',
      groupByField: 'owner',
      colorField: 'status',
      scale: 'week' as const,
    };
    const r = TimelineConfigSchema.safeParse(prescribed);
    expect(r.success, JSON.stringify(codesOf(r))).toBe(true);
    // Control: the block is not simply open — a key it does not declare is
    // still refused, so the green above is about these six names.
    const bogus = TimelineConfigSchema.safeParse({ ...prescribed, [BOGUS_KEY]: 1 });
    expect(bogus.success).toBe(false);
    expect(codesOf(bogus)).toContain('unrecognized_keys');
  });
});
