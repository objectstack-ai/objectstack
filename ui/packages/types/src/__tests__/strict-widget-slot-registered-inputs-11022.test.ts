/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The strict authoring face admits the widget-slot `metric-card`'s REGISTERED
 * inputs, and still refuses a key no registration declares (objectui#11022) —
 * since objectui#11467, because the slot arm DECLARES them.
 *
 * ## The defect
 *
 * `metric-card` sits in a dashboard's widget slot as a component node whose
 * props are its registry `inputs` (`title`, `value`, `icon`, `trend`,
 * `trendValue`, `description`). The strict walker closes every object's
 * catchall, so while the slot arm admitted those props through `BaseSchema`'s
 * `.passthrough()` alone, `StrictAnyComponentSchema` refused `value` on both
 * arms of the slot's union, as `unrecognized_keys`: every correctly authored
 * `metric-card` that carried its required input.
 *
 * ## Two repairs, in order
 *
 * objectui#11022 recorded the registration's input NAMES in a side table on the
 * arm, and the walker admitted exactly those, each judged by the arm's catchall
 * — so the strict face admitted the keys and judged no value. objectui#11467
 * declared the five inputs `BaseSchema` lacks as MEMBERS of the arm, typed as
 * `MetricCard`'s props (`description` is already a `BaseSchema` member), on
 * both faces and on the TypeScript twin. Every name the side table held became
 * a member, so the side table and the walker's arm for it were retired.
 *
 * ## What each block below holds
 *
 * The grade's pins; the content channels objectui#9256 refused staying
 * refused; each input judged by its member on BOTH faces; and the arm's shape
 * declaring the inputs, with the passthrough still keeping any other key on
 * the tolerant face.
 *
 * ⚠️ Where the grade's pin sits. `metric-card` is deliberately NOT an arm of
 * `AnyComponentSchema` (the ruling keeps it a property of the widget slot), so a
 * bare `{ type: 'metric-card', value: 42 }` at the ROOT is refused at `type` on
 * both faces, before and after this change — the control below says so. The
 * grade's widget therefore sits in a dashboard's `widgets` slot here.
 *
 * The parity of the declared members with the LIVE registration and with
 * `MetricCardProps` is measured by the registering package, which holds both:
 * `metricCardRegisteredInputsStrictFace-11022.test.ts` in
 * `@object-ui/plugin-dashboard`'s `__tests__`.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AnyComponentSchema,
  BaseSchema,
  DashboardComponentSchema,
  StrictAnyComponentSchema,
} from '../zod/index.zod.js';
import { internals } from '../zod/node-derivation.js';

/* ── Reading a refusal ───────────────────────────────────────────────────── */

type Issue = {
  code: string;
  path: PropertyKey[];
  message: string;
  keys?: string[];
  errors?: Issue[][];
};

const issuesOf = (schema: z.ZodType, doc: unknown): Issue[] | null => {
  const result = schema.safeParse(doc);
  return result.success ? null : (result.error.issues as unknown as Issue[]);
};

const dashboard = (widget: Record<string, unknown>) => ({ type: 'dashboard', widgets: [widget] });

/** The ONE issue a widget refusal surfaces as: an `invalid_union` at the widget. */
const widgetUnion = (schema: z.ZodType, doc: unknown): Issue | undefined =>
  issuesOf(schema, doc)?.find((i) => i.path.join('.') === 'widgets.0');

/* ── 1. the grade's pins ─────────────────────────────────────────────────── */

describe('objectui#11022 — the grade\'s pins, in the widget slot', () => {
  it('`{ type: \'metric-card\', value: 42 }` parses under StrictAnyComponentSchema', () => {
    const doc = dashboard({ type: 'metric-card', value: 42 });
    expect(issuesOf(StrictAnyComponentSchema, doc)).toBeNull();
    // Control: the tolerant face always accepted it — the two faces agree.
    expect(issuesOf(AnyComponentSchema, doc)).toBeNull();
  });

  it('`{ type: \'metric-card\', value: 42, bogus: 1 }` is still refused, by name, on the slot arm', () => {
    const issue = widgetUnion(StrictAnyComponentSchema, dashboard({ type: 'metric-card', value: 42, bogus: 1 }));
    expect(issue?.code).toBe('invalid_union');
    // Arm 1 is the component-node arm; its path is relative to the widget.
    const [slotArm, widgetArm] = issue?.errors ?? [];
    expect(slotArm).toEqual([expect.objectContaining({ code: 'unrecognized_keys', path: [], keys: ['bogus'] })]);
    // The strict widget schema, which the union falls through to, refuses it too
    // — and `value` with it, which is a component input and never a widget key.
    // Since objectui#11483 it refuses the `type` as well: `metric-card` is no widget type.
    expect(widgetArm).toHaveLength(2);
    expect(widgetArm).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unrecognized_keys', path: [], keys: ['value', 'bogus'] }),
      expect.objectContaining({ code: 'invalid_value', path: ['type'] }),
    ]));
  });

  it('CONTROL — `metric-card` is not a ROOT arm: refused at `type` on both faces, unchanged', () => {
    for (const face of [AnyComponentSchema, StrictAnyComponentSchema]) {
      const issues = issuesOf(face, { type: 'metric-card', value: 42 });
      expect(issues).toEqual([expect.objectContaining({ code: 'invalid_union', path: ['type'] })]);
    }
  });
});

/* ── 2. objectui#9256's refusals are untouched ───────────────────────────── */

describe('objectui#11022 — the content channels objectui#9256 refused stay refused on the strict face', () => {
  it.each(['children', 'body'])('`%s` on `metric-card` is refused with the by-name message', (key) => {
    const issue = widgetUnion(StrictAnyComponentSchema, dashboard({ type: 'metric-card', value: 42, [key]: [] }));
    expect(issue?.code).toBe('invalid_union');
    const refusal = (issue?.errors ?? []).flat().find((i) => i.path.join('.') === key && i.code === 'invalid_type');
    expect(refusal?.message).toContain('`metric-card` reads NEITHER content channel');
    expect(refusal?.message).toContain('objectui#9256');
  });
});

/* ── 3. each input is judged by its member, on both faces ────────────────── */

describe('objectui#11467 — the registered inputs are MEMBERS: each value is judged by its declared type on both faces', () => {
  const FULL = {
    type: 'metric-card',
    title: 'Revenue',
    value: '$24k',
    icon: 'dollar-sign',
    trend: 'up',
    trendValue: '+5%',
    description: 'vs last month',
  };

  it('a card carrying every registered input parses on both faces', () => {
    expect(issuesOf(StrictAnyComponentSchema, dashboard(FULL))).toBeNull();
    expect(issuesOf(AnyComponentSchema, dashboard(FULL))).toBeNull();
  });

  it('the members admit what `MetricCard` renders: a numeric `value`, an inline locale-map `title`, each `trend`', () => {
    for (const card of [
      { type: 'metric-card', value: 12480 },
      { type: 'metric-card', value: '1', title: { en: 'Revenue', 'zh-CN': '收入' } },
      ...(['up', 'down', 'neutral'] as const).map((trend) => ({ type: 'metric-card', value: '1', trend, trendValue: '1%' })),
    ]) {
      expect(issuesOf(StrictAnyComponentSchema, dashboard(card))).toBeNull();
      expect(issuesOf(AnyComponentSchema, dashboard(card))).toBeNull();
    }
  });

  // Each value is outside its member. Until objectui#11467 BOTH faces accepted
  // every row: the tolerant face through the catchall, the strict face through
  // the side table, which judged the value by that same catchall.
  it.each([
    ['trend', { trend: 'sideways' }],
    ['title', { title: 7 }],
    ['icon', { icon: 5 }],
    ['trendValue', { trendValue: 3 }],
    ['value', { value: { amount: 1 } }],
  ] as const)('`%s` with a value outside its member is refused on both faces, at that key', (key, extra) => {
    const doc = dashboard({ type: 'metric-card', value: 42, ...extra });
    for (const face of [AnyComponentSchema, StrictAnyComponentSchema]) {
      const issue = widgetUnion(face, doc);
      expect(issue?.code).toBe('invalid_union');
      // The COMPONENT arm's own verdict — the union's first arm.
      const [slotArm] = issue?.errors ?? [];
      expect(slotArm?.map((i) => i.path.join('.'))).toContain(key);
    }
  });

  it('`value` is required — the registration\'s one `required` input — on both faces', () => {
    const doc = dashboard({ type: 'metric-card', title: 'Revenue', icon: 'users' });
    for (const face of [AnyComponentSchema, StrictAnyComponentSchema]) {
      const [slotArm] = widgetUnion(face, doc)?.errors ?? [];
      // The member is `string | number` — the same spelling as the statistic's
      // `value` — so an absent one is refused at `value` by that union.
      expect(slotArm?.map((i) => i.path.join('.'))).toEqual(['value']);
    }
  });

  it('a registered input the base already declares keeps the base member\'s judgment', () => {
    // `description` is a `BaseSchema` member (a string or an inline locale map);
    // its declared type refuses a number on BOTH faces, and the arm does not
    // restate it.
    const bad = dashboard({ type: 'metric-card', value: 1, description: 42 });
    expect(issuesOf(AnyComponentSchema, bad)).not.toBeNull();
    expect(issuesOf(StrictAnyComponentSchema, bad)).not.toBeNull();
  });
});

/* ── 4. the arm's shape ──────────────────────────────────────────────────── */

describe('objectui#11467 — the inputs are members of the tolerant slot arm, which is still a passthrough', () => {
  /** The slot's component-node arm, read off the exported tolerant schema. */
  const tolerantSlotArm = (): z.ZodType => {
    const widgets = internals(DashboardComponentSchema)._zod.def.shape?.widgets;
    let node = widgets as z.ZodType;
    while (internals(node)._zod.def.innerType) node = internals(node)._zod.def.innerType as z.ZodType;
    const element = internals(node)._zod.def.element as z.ZodType;
    return (internals(element)._zod.def.options ?? [])[0] as z.ZodType;
  };

  it('its shape is the base\'s, plus `layout` and the five registered inputs the base lacks', () => {
    const arm = tolerantSlotArm();
    // The arm overrides `type`, `body` and `children`, all three base members,
    // and adds `layout` — the spec's widget position (objectui#11070 round 11), a
    // widget key and not a registered input — and the five inputs.
    const INPUTS = ['title', 'value', 'icon', 'trend', 'trendValue'];
    const baseKeys = Object.keys(internals(BaseSchema)._zod.def.shape ?? {}).sort();
    const armKeys = Object.keys(internals(arm)._zod.def.shape ?? {}).sort();
    for (const input of INPUTS) expect(baseKeys).not.toContain(input);
    expect(armKeys).toEqual([...baseKeys, 'layout', ...INPUTS].sort());
    // The sixth input is the base's member.
    expect(baseKeys).toContain('description');
  });

  it('its catchall is still the passthrough, so an undeclared key is still accepted there', () => {
    const arm = tolerantSlotArm();
    expect(internals(internals(arm)._zod.def.catchall as z.ZodType)._zod.def.type).toBe('unknown');
    expect(issuesOf(AnyComponentSchema, dashboard({ type: 'metric-card', value: 42, bogus: 1 }))).toBeNull();
  });
});
