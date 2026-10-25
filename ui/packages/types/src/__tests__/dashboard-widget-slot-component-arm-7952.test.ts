/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7952 — `DashboardComponentSchema.widgets` carries the component-node
 * arm on the TypeScript face, matching the Zod twin's two-arm slot.
 *
 * ## The gap this closes
 *
 * `zod/complex.zod.ts` has routed a `metric-card` node placed directly in the
 * widget slot to passthrough `BaseSchema` since the 2026-08-14 ruling
 * (objectstack#8593): `widgets: z.array(z.union([DashboardWidgetSlotComponentSchema,
 * DashboardWidgetSchema]))`. The TypeScript declaration stayed one-armed,
 * `DashboardWidgetSchema[]`. Measured at `fc32921` on the six dashboard blocks
 * `plugin-dashboard/README.md` teaches, each annotated `DashboardComponentSchema`:
 * `safeParse` ACCEPT with every authored key preserved; `tsc --strict` 6 × TS2561
 * (`'value' does not exist in type 'DashboardWidgetSchema'. Did you mean to
 * write 'values'?`). No annotation existed for a document the platform accepts
 * and the maintainer ruled legal. Ruled option (a), director seat, decision
 * batch #68 (2026-09-07): the TypeScript face gains the arm; the Zod face is
 * untouched and `DashboardWidgetSchema` is NOT widened.
 *
 * ## What is pinned, and on which face
 *
 *   1. the README's `metric-card` shape annotates and compiles (type level) AND
 *      parses green with its keys kept (runtime) — the two halves of the card's
 *      measurement, now agreeing;
 *   2. the forbidden repair did not happen: `DashboardWidgetSchema` still refuses
 *      `value` — an `@ts-expect-error` that turns into TS2578 if anyone widens it;
 *   3. the arm is CLOSED on `type` and the union still discriminates: a
 *      spec-family widget with an undeclared key is refused on both faces, and a
 *      `type` in neither vocabulary is refused;
 *   4. the measured limit of a TypeScript union with a passthrough arm, recorded
 *      two-faced so it could not be read as a hatch: a `type`-less legacy
 *      envelope with an undeclared key COMPILED (nothing to discriminate on, so
 *      the arm's index signature satisfied the excess-property check) while the
 *      Zod face refused it by name; objectui#8347 removed the signature, tsc
 *      refuses it now, and the block is gone (a note marks where it stood);
 *   5. shape identity: the slot's element type IS the two-arm union, the arm's
 *      `type` IS `DashboardComponentWidgetType`, and the arm is NOT assignable
 *      to `DashboardWidgetSchema` (objectui#11514). It was until that card,
 *      which is why every `(w: DashboardWidgetSchema)` callback in
 *      `plugin-dashboard` compiled unchanged; those callbacks now read an entry
 *      by this element type, and the widget arm's `type` names no component
 *      type, so a `metric-card` with no `value` is refused on this face too;
 *   6. objectui#11467: the arm DECLARES `MetricCard`'s registered inputs, so the
 *      README's `metric-card` literals compile against members rather than
 *      against `BaseSchema`'s index signature (which objectui#8347 removed);
 *      the Zod twin declares the same members; and the widget's `component`
 *      slot takes the arm first, on both faces. The members' parity with the
 *      live registration and `MetricCardProps` is pinned in
 *      `@object-ui/plugin-dashboard` (`metricCardRegisteredInputsStrictFace-11022.test.ts`);
 *   7. objectui#4425: `label`, the inherited `BaseSchema` member `MetricCard` never
 *      reads, is refused by name on the tolerant face, the strict face and the
 *      TypeScript twin, and the message names `title`, the heading the card draws.
 *      That the same card with `title` draws its heading is pinned where it renders,
 *      `@object-ui/plugin-dashboard`'s `metricCardLabelRefusedTitleHeading-4425.test.tsx`;
 *   8. objectui#11709: inside a widget's legacy `component` envelope, a `metric-card`
 *      is judged by the arm ALONE on the tolerant face too
 *      (`safeValidateSchema`). One enumeration pin derives every refusal
 *      from the arm's own members and proves each is refused there with the
 *      member's own message, and with no `BaseSchema` fallback beside it. It
 *      replaced the two "MEASURED LIMIT" notes that recorded the fallback.
 *
 * Type-level lines are erased at runtime and enforced because
 * `packages/types/tsconfig.test.json` is chained from this package's
 * `type-check` script (objectui#3009). Reverse-verified at the PR: with `widgets`
 * restored to `DashboardWidgetSchema[]`, `tsc -p tsconfig.test.json` goes red on
 * the lines marked REVERSE below and nowhere else in this file.
 */

import { describe, it, expect } from 'vitest';
import type { z } from 'zod';
import type { I18nLabel } from '@objectstack/spec/ui';
import type {
  DashboardComponentSchema,
  DashboardComponentWidgetType,
  DashboardWidgetSchema,
  DashboardWidgetSlotComponentSchema,
} from '../complex.js';
import { DASHBOARD_COMPONENT_WIDGET_TYPES } from '../complex.js';
import { DashboardComponentSchema as DashboardComponentZod, DashboardWidgetSchema as DashboardWidgetZod } from '../zod/complex.zod.js';
import { StrictAnyComponentSchema, safeValidateSchema } from '../zod/index.zod.js';

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;

/**
 * `packages/plugin-dashboard/README.md`'s "Usage" block, byte-for-byte, with the
 * annotation the card measured it under. The runtime half of the same document
 * is read off the page by `plugin-dashboard`'s
 * `readme-dashboard-examples-spec-valid.test.ts`; this copy exists because a
 * type-level pin cannot read a file.
 */
// REVERSE — TS2561 on `value` with the one-arm declaration.
const usage: DashboardComponentSchema = {
  type: 'dashboard',
  widgets: [
    {
      type: 'metric-card',
      title: 'Total Sales',
      value: '$123,456',
      trend: 'up',
      trendValue: '+12%'
    }
  ]
};

describe('the component-node arm is declared on the TypeScript face (objectui#7952)', () => {
  it('the README shape annotates, compiles, and parses green with every key kept', () => {
    const result = DashboardComponentZod.safeParse(usage);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const parsed = (result.data as { widgets: Record<string, unknown>[] }).widgets[0];
    for (const key of Object.keys(usage.widgets[0])) expect(parsed).toHaveProperty(key);
  });

  it('the slot element IS the two-arm union, in the Zod twin\'s order', () => {
    type Element = DashboardComponentSchema['widgets'][number];
    // REVERSE — `Element` collapses to `DashboardWidgetSchema` and this is `false`.
    const twoArm: Equal< Element, DashboardWidgetSlotComponentSchema | DashboardWidgetSchema > = true;
    // The arm's `type` is the closed component set, by reference — not a copy.
    const closedByReference: Equal< DashboardWidgetSlotComponentSchema['type'], DashboardComponentWidgetType > = true;
    // objectui#11514: the arm is NOT assignable to the widget type, whose `type`
    // names no component type. A consumer reads an entry by `Element` and narrows
    // on `type` to reach a widget key.
    const armDisjoint: DashboardWidgetSlotComponentSchema extends DashboardWidgetSchema ? false : true = true;
    expect(twoArm && closedByReference && armDisjoint).toBe(true);
    // The runtime side of "by reference": the set the arm keys on is the one
    // export, and it is the set the Zod arm reads.
    expect(DASHBOARD_COMPONENT_WIDGET_TYPES).toContain(usage.widgets[0].type);
  });
});

describe('the forbidden repair did not happen — DashboardWidgetSchema is not widened', () => {
  it('`value` is still not a widget key on the TypeScript face', () => {
    // `value` / `icon` / `trend` / `trendValue` are `MetricCard`'s registry
    // inputs. The compiler's own suggestion for this line ("Did you mean to
    // write 'values'?") is the repair both declarations forbid; if anyone
    // makes it, this directive goes unused (TS2578) and `type-check` fails.
    // A widget family, so `value` is the one refused key (since objectui#11514 a
    // `type: 'metric-card'` is refused on this interface as well).
    // @ts-expect-error — TS2561: 'value' does not exist in type 'DashboardWidgetSchema'.
    const widened: DashboardWidgetSchema = { type: 'metric', value: '1' };
    expect(widened.type).toBe('metric');
  });

  it('the arm\'s `type` is closed', () => {
    // @ts-expect-error — TS2322: a spec family is not a component type.
    const open: DashboardWidgetSlotComponentSchema = { type: 'bar', value: '1' };
    expect(open.type).toBe('bar');
  });
});

describe('NOT A HATCH — what the union still refuses, on both faces', () => {
  it('a spec-family widget with an undeclared key is discriminated by `type` and refused', () => {
    const doc: DashboardComponentSchema = {
      type: 'dashboard',
      widgets: [
        // `'bar'` excludes the component arm, so the excess-property check runs
        // against `DashboardWidgetSchema` alone.
        // @ts-expect-error — TS2353: 'bogus' does not exist in type 'DashboardWidgetSchema'.
        { type: 'bar', title: 'x', bogus: 1 },
      ],
    };
    const result = DashboardComponentZod.safeParse(doc);
    expect(result.success).toBe(false);
    if (result.success) return;
    const flat = JSON.stringify(result.error.issues);
    expect(flat).toContain('unrecognized_keys');
    expect(flat).toContain('bogus');
  });

  it('a `type` in neither vocabulary is refused', () => {
    const doc: DashboardComponentSchema = {
      type: 'dashboard',
      widgets: [
        // @ts-expect-error — TS2322: not a widget family, not a component type.
        { type: 'not-a-component', value: '1' },
      ],
    };
    expect(DashboardComponentZod.safeParse(doc).success).toBe(false);
  });

  it('a component node with an undeclared key is kept whole — that is the passthrough, by ruling', () => {
    const doc: DashboardComponentSchema = {
      type: 'dashboard',
      // `value` is the card's required input since objectui#11467; `someProp` is the undeclared key.
      // The TS face refuses it since objectui#8347 removed `BaseSchema`'s index
      // signature; the passthrough this test reads is the zod face's.
      // @ts-expect-error — `DashboardWidgetSlotComponentSchema` declares no `someProp` (objectui#8347)
      widgets: [{ type: 'metric-card', title: 'x', value: '1', someProp: 1 }],
    };
    const result = DashboardComponentZod.safeParse(doc);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as { widgets: Record<string, unknown>[] }).widgets[0]).toHaveProperty('someProp', 1);
  });
});

// A `MEASURED LIMIT` block stood here: a `type`-less legacy envelope carrying an
// undeclared key compiled, because the component arm's index signature
// satisfied the union's excess-property check. objectui#8347 removed
// `BaseSchema`'s signature, tsc refused the literal, and the block's own removal
// condition deleted it together with the note on `widgets` in `complex.ts`.
describe('the legacy `component` envelope on the TypeScript face (objectui#7952, objectui#8347)', () => {
  it('a `metric-card` with no `value` inside the envelope is refused (objectui#8347, Q3 = A)', () => {
    const valueless: DashboardComponentSchema = {
      type: 'dashboard',
      // @ts-expect-error — `value` is the card's one required input, inside the envelope too (the diagnostic names `value`).
      widgets: [{ id: 'w', component: { type: 'metric-card', title: 'Revenue' } }],
    };
    // The tolerant zod face accepted this document through the widget
    // `component` slot's `BaseSchema` arm until objectui#11709, which routes a
    // `metric-card` there to the arm alone. The objectui#11709 enumeration pin
    // below derives the omission from the arm's required `value`.
    expect(valueless.type).toBe('dashboard');
    expect(safeValidateSchema(valueless).success).toBe(false);
  });

  it('the same envelope with `value` is legal on both faces (the control)', () => {
    const envelope: DashboardComponentSchema = {
      type: 'dashboard',
      widgets: [{ id: 'w', component: { type: 'metric-card', value: '1' }, layout: { x: 0, y: 0, w: 1, h: 1 } }],
    };
    expect(DashboardComponentZod.safeParse(envelope).success).toBe(true);
  });
});

/* ── objectui#11467 — the arm declares MetricCard's registered inputs ─────── */

type MetricCardInput = 'title' | 'value' | 'icon' | 'trend' | 'trendValue';

/** The zod arm is private; its input type is read off the slot's element union. */
type ZodSlotArm = Extract< z.input< typeof DashboardComponentZod >['widgets'][number], { type: 'metric-card' } >;

/**
 * `plugin-dashboard/README.md`'s "TypeScript Support" block, the two
 * `metric-card` literals, byte-for-byte, with their annotations: the card in a
 * widget's `component` slot, and the card directly in `widgets[]`. Read off the
 * page by `check:doc-snippets`; copied here because a type-level pin cannot
 * read a file. Both compiled before objectui#11467 only through `BaseSchema`'s
 * index signature (the objectui#8347 census: `value`, three times in this file).
 */
const custom: DashboardWidgetSchema = {
  id: 'kpi_custom',
  component: {
    type: 'metric-card',
    title: 'Revenue',
    value: '$123,456',
    trend: 'up',
    trendValue: '+12%',
  },
  layout: { x: 0, y: 0, w: 3, h: 2 },
};

const kpi: DashboardWidgetSlotComponentSchema = {
  type: 'metric-card',
  title: 'Revenue',
  value: '$123,456',
  trend: 'up',
  trendValue: '+12%',
};

describe('objectui#11467 — the component arm declares `MetricCard`\'s registered inputs, on both faces', () => {
  it('each input is a DECLARED member with `MetricCard`\'s prop type — not the index signature\'s `any`', () => {
    // Through the index signature each of these was `any`, and `Equal< any, X >` is `false`.
    const title: Equal< DashboardWidgetSlotComponentSchema['title'], string | I18nLabel | undefined > = true;
    const value: Equal< DashboardWidgetSlotComponentSchema['value'], string | number > = true;
    const icon: Equal< DashboardWidgetSlotComponentSchema['icon'], string | undefined > = true;
    const trend: Equal< DashboardWidgetSlotComponentSchema['trend'], 'up' | 'down' | 'neutral' | undefined > = true;
    const trendValue: Equal< DashboardWidgetSlotComponentSchema['trendValue'], string | undefined > = true;
    // `description`, the sixth input, is the base's member, not restated.
    const description: Equal< DashboardWidgetSlotComponentSchema['description'], string | I18nLabel | undefined > = true;
    expect([title, value, icon, trend, trendValue, description]).toEqual([true, true, true, true, true, true]);
  });

  it('the Zod twin declares the same five members with the same types', () => {
    const twins: Equal< Required< Pick< ZodSlotArm, MetricCardInput > >, Required< Pick< DashboardWidgetSlotComponentSchema, MetricCardInput > > > = true;
    expect(twins).toBe(true);
  });

  it('the TypeScript face judges each value by its member', () => {
    // @ts-expect-error — TS2322: `trend` is the registration's enum.
    const sideways: DashboardWidgetSlotComponentSchema = { type: 'metric-card', value: '1', trend: 'sideways' };
    // @ts-expect-error — TS2741: `value` is the card's one required input.
    const valueless: DashboardWidgetSlotComponentSchema = { type: 'metric-card', title: 'Revenue', icon: 'users' };
    const doc: DashboardComponentSchema = {
      type: 'dashboard',
      // @ts-expect-error — TS2322: no arm admits it: the component arm judges `trend`, and `value` is no widget key.
      widgets: [{ type: 'metric-card', value: '1', trend: 'sideways' }],
    };
    expect([sideways.trend, valueless.type, doc.type]).toEqual(['sideways', 'metric-card', 'dashboard']);
  });

  it('`title`, declared on both arms, reads with its declared type straight off a `widgets[]` entry — not `any`', () => {
    // The plugin-dashboard README says so ("Reading a widget key off `widgets[]`").
    const read: Equal< DashboardComponentSchema['widgets'][number]['title'], string | I18nLabel | undefined > = true;
    expect(read).toBe(true);
  });

  it('the widget `component` slot is typed with the component arm alone (objectui#12163, ruling C)', () => {
    // It was `DashboardWidgetSlotComponentSchema | SchemaNode` until objectui#12163.
    const slot: Equal< NonNullable< DashboardWidgetSchema['component'] >, DashboardWidgetSlotComponentSchema > = true;
    expect(slot).toBe(true);
  });

  it('the README\'s two `metric-card` literals parse on both faces, every key kept', () => {
    const doc = { type: 'dashboard', widgets: [custom, kpi] };
    const result = DashboardComponentZod.safeParse(doc);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const [parsedCustom, parsedKpi] = (result.data as { widgets: Record<string, Record<string, unknown>>[] }).widgets;
    for (const key of Object.keys(custom.component as object)) expect(parsedCustom.component).toHaveProperty(key);
    for (const key of Object.keys(kpi)) expect(parsedKpi).toHaveProperty(key);
    // The strict authoring face: before objectui#11467 it refused the `component`
    // card's five inputs as unrecognized (`BaseSchema` alone in that slot).
    expect(StrictAnyComponentSchema.safeParse(doc).success).toBe(true);
  });

  it('in the `component` slot the strict face judges a card by the arm, and refuses any other node by name', () => {
    const issues = (doc: unknown): string => {
      const result = StrictAnyComponentSchema.safeParse(doc);
      return result.success ? '' : JSON.stringify(result.error.issues);
    };
    const envelope = (component: Record<string, unknown>) => ({ type: 'dashboard', widgets: [{ id: 'w', component }] });
    const sideways = issues(envelope({ type: 'metric-card', value: '1', trend: 'sideways' }));
    expect(sideways).toContain('"trend"');
    // The tolerant face refuses the same card since objectui#11709, and the
    // TypeScript union already did. That is pinned once for every refusal the
    // arm carries, by the objectui#11709 enumeration pin below.
    // CONTROL, flipped by objectui#12163 (ruling C): a non-card node in the slot was
    // judged by `BaseSchema` and parsed; it is now refused by name on both faces, one
    // `custom` issue at the slot naming the node (`dashboard-custom-component-own-type-12163.test.ts`).
    for (const face of [StrictAnyComponentSchema, DashboardComponentZod]) {
      const result = face.safeParse(envelope({ type: 'chart' }));
      expect(result.success).toBe(false);
      const slot = flatIssues(result).filter((i) => i.path.join('.') === 'widgets.0.component');
      expect(slot.map((i) => i.code)).toEqual(['custom']);
      expect(slot[0].message).toContain('`chart` node');
    }
  });
});

/* ── objectui#4425 — `label` is refused by name, and the remedy is `title` ── */

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[]; errors?: Issue[][] };

/** The private arm, reached the one way it is reachable: the slot's union, first member. */
const slotArm = (
  DashboardComponentZod.shape.widgets as unknown as { element: { options: [{ shape: Record<string, { description?: string }> }] } }
).element.options[0];

/** Every issue, the union's per-arm `errors` flattened in, each path made absolute. */
const flatIssues = (result: { success: boolean; error?: { issues: unknown[] } }): Issue[] => {
  const out: Issue[] = [];
  const walk = (list: Issue[], prefix: PropertyKey[]) => {
    for (const issue of list) {
      out.push({ ...issue, path: [...prefix, ...issue.path] });
      for (const arm of issue.errors ?? []) walk(arm, [...prefix, ...issue.path]);
    }
  };
  if (!result.success) walk(result.error!.issues as Issue[], []);
  return out;
};

describe('objectui#4425 — `label` on the slot\'s `metric-card` is refused by name, naming `title`', () => {
  const card = { type: 'metric-card', value: '$123,456' } as const;
  const dashboard = (widget: Record<string, unknown>) => ({ type: 'dashboard', widgets: [widget] });
  const labelRefusal = (doc: unknown, face: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } }) =>
    flatIssues(face.safeParse(doc)).find((i) => i.path.join('.') === 'widgets.0.label' && i.code === 'invalid_type');

  it('CONTROL — the same card with `title` parses on both faces, every key kept', () => {
    const titled = dashboard({ ...card, title: 'Total Revenue' });
    const result = DashboardComponentZod.safeParse(titled);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as { widgets: Record<string, unknown>[] }).widgets[0]).toHaveProperty('title', 'Total Revenue');
    expect(StrictAnyComponentSchema.safeParse(titled).success).toBe(true);
  });

  it.each([
    ['the tolerant face', DashboardComponentZod],
    ['the strict authoring face', StrictAnyComponentSchema],
  ] as const)('%s refuses `label` at the key\'s own path, and the message names `title`', (_face, face) => {
    for (const widget of [{ ...card, label: 'Total Revenue' }, { ...card, title: 'Total Revenue', label: 'Total Revenue' }]) {
      const doc = dashboard(widget);
      expect(face.safeParse(doc).success, JSON.stringify(widget)).toBe(false);
      const refusal = labelRefusal(doc, face);
      expect(refusal?.message).toContain('Did you mean `label` → `title`?');
      expect(refusal?.message).toContain('objectui#4425');
      expect(refusal?.message).toContain('`metric-card` spells its heading `title`');
    }
  });

  it('the refusal is about the KEY, not a value domain: every value is refused', () => {
    for (const value of ['Total Revenue', { en: 'Revenue', 'zh-CN': '收入' }, '', 42, null]) {
      expect(labelRefusal(dashboard({ ...card, label: value }), DashboardComponentZod), JSON.stringify(value)).toBeDefined();
    }
  });

  it('`label` is a MEMBER of the arm, and ONE string feeds both channels: the message IS its `.describe()`', () => {
    const refusal = labelRefusal(dashboard({ ...card, label: 'x' }), DashboardComponentZod);
    expect(slotArm.shape.label?.description).toBe(refusal?.message);
  });

  it('the TypeScript face refuses `label` at the AUTHORING site, on the arm and inside `widgets[]` (`tsc` is the reader)', () => {
    const member: Equal< DashboardWidgetSlotComponentSchema['label'], undefined > = true;
    const ok = { type: 'metric-card', title: 'Total Revenue', value: '1' } satisfies DashboardWidgetSlotComponentSchema;
    // @ts-expect-error objectui#4425 — the card's heading is `title`
    const onArm: DashboardWidgetSlotComponentSchema = { type: 'metric-card', value: '1', label: 'Total Revenue' };
    const inSlot: DashboardComponentSchema = {
      type: 'dashboard',
      // @ts-expect-error objectui#4425 — no arm admits a `metric-card` carrying `label`
      widgets: [{ type: 'metric-card', value: '1', label: 'Total Revenue' }],
    };
    expect([member, ok.type, onArm.type, inSlot.type]).toEqual([true, 'metric-card', 'metric-card', 'dashboard']);
  });

  it('in the legacy `component` envelope: the strict face and `tsc` refuse it', () => {
    const envelope = { type: 'dashboard', widgets: [{ id: 'w', component: { ...card, label: 'Total Revenue' } }] };
    expect(StrictAnyComponentSchema.safeParse(envelope).success).toBe(false);
    expect(JSON.stringify(flatIssues(StrictAnyComponentSchema.safeParse(envelope)))).toContain('Did you mean `label` → `title`?');
    const typed: DashboardComponentSchema = {
      type: 'dashboard',
      // @ts-expect-error objectui#4425 — inside the envelope too
      widgets: [{ id: 'w', component: { type: 'metric-card', value: '1', label: 'Total Revenue' } }],
    };
    // The tolerant face refuses it too since objectui#11709. It is one probe of
    // the enumeration pin below, which derives `label` from the arm's members.
    expect(typed.type).toBe('dashboard');
  });
});

/* ── objectui#11709 — in the legacy `component` envelope, the arm alone judges a card ── */

/** A member of the arm, read the way the enumeration reads it: its own parse, and its optionality. */
type ArmMember = { safeParse: (value: unknown) => { success: boolean; error?: { issues: Issue[] } }; _zod: { optin?: string } };

/** A probe: the well-formed card with one member authored wrong (or omitted), and that member's own first issue. */
type Refusal = { key: string; authored: string; component: Record<string, unknown>; expected: Issue };

describe('objectui#11709 — the legacy `component` envelope judges a `metric-card` by the arm alone, at `objectui validate`', () => {
  /** The widget's `component` slot, unwrapped from `.optional()`: the routed two-arm union. */
  const slot = (DashboardWidgetZod.shape.component as unknown as { unwrap: () => { options: readonly unknown[] } }).unwrap();
  const card = { type: 'metric-card', value: '$123,456' } as const;
  const envelope = (component: Record<string, unknown>) => ({ type: 'dashboard', widgets: [{ id: 'w', component }] });

  /**
   * Every refusal the arm carries, DERIVED from the arm, never listed (objectui#11709's pin).
   *
   * For each member except the discriminator `type` (a different `type` is refused by the slot's
   * refusal arm, objectui#12163), the probe authors the first of these JSON values that the member itself refuses.
   * A tombstone refuses the first, an enum refuses the first as out of vocabulary, and a typed
   * member refuses a value of another kind. A required member also gets an omission probe. A
   * member that refuses none of them (`data`, typed `any`) yields no probe. So a refusal added
   * to the arm later, whether a tombstone, an enum or a required input, is enumerated here with
   * no edit. ⚠️ The bound, said per AGENTS.md #9: a refusal that only a value outside this list
   * trips (a `.refine` on a member, say) is not derived.
   */
  const CANDIDATES: readonly unknown[] = ['__not_a_member__', 42, true, null, {}, []];
  const refusals: Refusal[] = Object.entries(slotArm.shape as unknown as Record<string, ArmMember>)
    .filter(([key]) => key !== 'type')
    .flatMap(([key, member]) => {
      const out: Refusal[] = [];
      const authored = CANDIDATES.find((value) => !member.safeParse(value).success);
      if (authored !== undefined) {
        out.push({ key, authored: JSON.stringify(authored), component: { ...card, [key]: authored }, expected: member.safeParse(authored).error!.issues[0] });
      }
      const omission = member.safeParse(undefined);
      if (!omission.success) {
        const component: Record<string, unknown> = { ...card };
        delete component[key];
        out.push({ key, authored: '(omitted)', component, expected: omission.error!.issues[0] });
      }
      return out;
    });

  it('the slot\'s first arm IS the arm `widgets[]` holds a card by: one arm, two slots', () => {
    expect(slot.options[0]).toBe(slotArm);
  });

  it('LIT CONTROL — the derivation reaches the refusals the card named, and the required `value`', () => {
    // Not the population (that is `refusals`): the floor that keeps a derivation reading
    // nothing from passing with zero probes. A refusal retired from the arm turns this red.
    const keys = new Set(refusals.map((r) => r.key));
    for (const key of ['label', 'body', 'children', 'trend', 'value']) expect(keys, key).toContain(key);
    expect(refusals.find((r) => r.key === 'value' && r.authored === '(omitted)')).toBeDefined();
  });

  it('CONTROL — a well-formed card, and the same card with `title`, parse on both faces with every key kept', () => {
    for (const component of [card, { ...card, title: 'Total Revenue' }]) {
      const result = safeValidateSchema(envelope(component));
      expect(result.success, JSON.stringify(component)).toBe(true);
      if (!result.success) continue;
      const parsed = (result.data as { widgets: { component: Record<string, unknown> }[] }).widgets[0].component;
      expect(parsed).toEqual(component);
      expect(StrictAnyComponentSchema.safeParse(envelope(component)).success).toBe(true);
    }
  });

  it('CONTROL, flipped by objectui#12163 (ruling C) — every other node a `custom` widget\'s `component` carries is refused by name, not passed through', () => {
    const doc = { type: 'dashboard', widgets: [{ id: 'w', type: 'custom', component: { type: 'text', content: 'hello', someProp: 1 } }] };
    const result = safeValidateSchema(doc);
    expect(result.success).toBe(false);
    const slot = flatIssues(result).filter((i) => i.path.join('.') === 'widgets.0.component');
    expect(slot.map((i) => i.code)).toEqual(['custom']);
    expect(slot[0].message).toContain('`text` node');
  });

  it.each(refusals.map((r) => [`${r.key}: ${r.authored}`, r] as const))(
    '%s — refused through the envelope with the member\'s own message, and judged by the arm alone',
    (_name, refusal) => {
      const doc = envelope(refusal.component);
      const result = safeValidateSchema(doc);
      expect(result.success).toBe(false);
      const issues = flatIssues(result);
      const at = ['widgets', 0, 'component', refusal.key, ...refusal.expected.path].join('.');
      const own = issues.find((i) => i.path.join('.') === at && i.code === refusal.expected.code);
      expect(own?.message, at).toBe(refusal.expected.message);
      // No union issue at the slot: nothing but the arm judged the card, so no `BaseSchema`
      // reading stands beside the arm's (before objectui#11709 one did, or it accepted).
      expect(issues.filter((i) => i.path.join('.') === 'widgets.0.component' && i.code === 'invalid_union')).toEqual([]);
      expect(StrictAnyComponentSchema.safeParse(doc).success).toBe(false);
    },
  );
});
