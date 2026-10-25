/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11483 — a `metric-card` in a dashboard's widget slot parses only
 * with the `value` it draws.
 *
 * ## The defect
 *
 * The widget arm's `type` vocabulary (`DashboardWidgetTypeSchema`) named the
 * component type `metric-card`. So a card carrying only keys both arms accept,
 * `{ type: 'metric-card', title: 'Revenue' }`, parsed as a WIDGET on the
 * tolerant face (`DashboardComponentSchema` / `AnyComponentSchema`) and on the
 * strict one (`StrictAnyComponentSchema`). The component arm's required
 * `value` (objectui#11467) governed only a card that also carried a card-only
 * input. The dashboard then drew `MetricCard` with an empty figure.
 *
 * ## The ruling, and the measurement that picked its arm
 *
 * Triage's ruling on objectui#11483: a `metric-card` parses only when it
 * carries what the card draws from, which is its `value`, or the widget arm's
 * own data binding if that arm declares one. With neither, it is refused.
 * Measured through the real `DashboardRenderer` and `DashboardGridLayout`, no
 * widget key binds the card's figure: a `dataset` then drew `DatasetWidget` in
 * the card's place, by a rule that ignored the `type`, and the `options` bag
 * was spread onto the node as literal props, which is not a binding. Since
 * objectui#11598 (2026-10-04) both surfaces read a widget key on the widget
 * arm alone, so a card carrying one draws its own keys and is not drawn as a
 * widget. So `metric-card` left the widget vocabulary, and the component
 * arm's required `value` governs alone. The probe's readings are in that
 * card's pull request; this file pins the contract, not the probe.
 *
 * ## What is pinned
 *
 *   1. the measured node is refused on every face, by BOTH arms of the slot:
 *      the component arm at `value`, the widget arm at `type`;
 *   2. a card with its `value` parses on every face;
 *   3. no widget key stands in for `value`: a dataset-bound card and a card
 *      whose figure sits in `options` are refused. CONTROL: the dataset-bound
 *      single figure's own spelling, a `metric` widget, parses;
 *   4. the vocabulary on both faces: no component type is a widget type, and
 *      the TypeScript widget interface's `type` names none either
 *      (objectui#11514): a slot entry is read by the slot's element type, so a
 *      `metric-card` literal with no `value` is refused by `tsc` too.
 *
 * The registration's `required` against the slot is pinned where the live
 * registration is: `metricCardRegisteredInputsStrictFace-11022.test.ts` in
 * `@object-ui/plugin-dashboard`'s `__tests__`.
 */

import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type {
  DashboardComponentSchema,
  DashboardComponentWidgetType,
  DashboardWidgetSchema,
  DashboardWidgetTypeName,
} from '../complex.js';
import { DASHBOARD_COMPONENT_WIDGET_TYPES } from '../complex.js';
import {
  AnyComponentSchema,
  DashboardComponentSchema as DashboardComponentZod,
  DashboardWidgetSchema as DashboardWidgetZod,
  DashboardWidgetTypeSchema,
  StrictAnyComponentSchema,
} from '../zod/index.zod.js';

type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;

type Issue = { code: string; path: PropertyKey[]; keys?: string[]; errors?: Issue[][] };

/** Every face a dashboard document is judged by. */
const FACES: ReadonlyArray<readonly [string, z.ZodType]> = [
  ['tolerant DashboardComponentSchema', DashboardComponentZod],
  ['tolerant AnyComponentSchema', AnyComponentSchema],
  ['strict StrictAnyComponentSchema', StrictAnyComponentSchema],
];

const dashboard = (widget: Record<string, unknown>) => ({ type: 'dashboard', widgets: [widget] });

/** The slot's verdict on its one widget: the `invalid_union` at `widgets.0`, both arms' issues under it. */
const slotRefusal = (face: z.ZodType, doc: unknown): Issue | undefined => {
  const result = face.safeParse(doc);
  if (result.success) return undefined;
  return (result.error.issues as unknown as Issue[]).find((i) => i.path.join('.') === 'widgets.0');
};

const paths = (issues: readonly Issue[] | undefined) => (issues ?? []).map((i) => `${i.code}@${i.path.join('.')}`);

/* ── 1. the measured node ────────────────────────────────────────────────── */

describe('objectui#11483 — `{ type: \'metric-card\', title }` is refused on every face', () => {
  it.each(FACES)('%s: refused at the widget, by the component arm at `value` and the widget arm at `type`', (_name, face) => {
    const refusal = slotRefusal(face, dashboard({ type: 'metric-card', title: 'Revenue' }));
    expect(refusal?.code).toBe('invalid_union');
    const [componentArm, widgetArm] = refusal?.errors ?? [];
    // The component arm, first in the union: its required `value` is missing.
    expect(paths(componentArm)).toEqual(['invalid_union@value']);
    // The widget arm: `metric-card` is no widget type, so this arm is no second
    // reading of the card. Before the change this arm ACCEPTED the node.
    expect(paths(widgetArm)).toEqual(['invalid_value@type']);
  });

  it.each(FACES)('%s: so is the bare type, and a card carrying every other key both arms accept', (_name, face) => {
    for (const card of [
      { type: 'metric-card' },
      { type: 'metric-card', id: 'kpi', title: 'Revenue', description: 'vs last month', layout: { x: 0, y: 0, w: 3, h: 2 } },
    ]) {
      expect(paths(slotRefusal(face, dashboard(card))?.errors?.[0]), JSON.stringify(card)).toEqual(['invalid_union@value']);
    }
  });
});

/* ── 2. a card with its value ────────────────────────────────────────────── */

describe('objectui#11483 — a card with its `value` passes on every face', () => {
  it.each(FACES)('%s', (_name, face) => {
    for (const value of ['$24k', 12480]) {
      expect(face.safeParse(dashboard({ type: 'metric-card', title: 'Revenue', value })).success).toBe(true);
    }
  });
});

/* ── 3. no widget key stands in for `value` ──────────────────────────────── */

describe('objectui#11483 — no widget key stands in for the card\'s `value`', () => {
  it.each(FACES)('%s: a dataset-bound card is refused at `value`', (_name, face) => {
    // `dataset` is not the card's binding. The dashboard used to draw
    // `DatasetWidget` in the card's place for it; since objectui#11598 it reads
    // `dataset` on the widget arm alone, so the card draws its own keys.
    const refusal = slotRefusal(face, dashboard({ type: 'metric-card', title: 'Revenue', dataset: 'sales', values: ['revenue'] }));
    expect(refusal?.code).toBe('invalid_union');
    expect(paths(refusal?.errors?.[0])).toContain('invalid_union@value');
    expect(paths(refusal?.errors?.[1])).toContain('invalid_value@type');
  });

  it.each(FACES)('%s: a card whose figure sits in `options` is refused at `value`', (_name, face) => {
    // The surfaces used to spread `options` onto the node, so `options.value`
    // reached the card as its prop: a second spelling of `value`, which the
    // tolerant face accepted until this change. Since objectui#11598 no surface
    // reads `options` off a card.
    const refusal = slotRefusal(face, dashboard({ type: 'metric-card', title: 'Revenue', options: { value: '$24k' } }));
    expect(refusal?.code).toBe('invalid_union');
    expect(paths(refusal?.errors?.[0])).toContain('invalid_union@value');
  });

  it.each(FACES)('%s: CONTROL — the dataset-bound single figure\'s own spelling, a `metric` widget, parses', (_name, face) => {
    expect(face.safeParse(dashboard({ type: 'metric', title: 'Revenue', dataset: 'sales', values: ['revenue'] })).success).toBe(true);
  });
});

/* ── 4. the vocabulary ───────────────────────────────────────────────────── */

describe('objectui#11483 — no component type is a widget type', () => {
  it('the Zod vocabulary names no member of the component set, and the widget arm refuses each at `type`', () => {
    // Non-vacuity: the set this walks is not empty.
    expect(DASHBOARD_COMPONENT_WIDGET_TYPES.length).toBeGreaterThan(0);
    const vocabulary = new Set<string>(DashboardWidgetTypeSchema.options);
    for (const type of DASHBOARD_COMPONENT_WIDGET_TYPES) {
      expect(vocabulary.has(type), `\`${type}\` is a widget type`).toBe(false);
      const result = DashboardWidgetZod.safeParse({ id: 'w', type });
      expect(result.success).toBe(false);
      expect(paths(result.success ? [] : (result.error.issues as unknown as Issue[]))).toEqual(['invalid_value@type']);
    }
  });

  it('the TypeScript twin agrees, and the widget interface names no component type either', () => {
    // `DashboardWidgetTypeName` is the twin of `DashboardWidgetTypeSchema`: the two are disjoint
    // from the component set. An authoring surface typed by it cannot offer the card as a widget.
    const disjoint: Equal< Extract< DashboardWidgetTypeName, DashboardComponentWidgetType >, never > = true;
    // objectui#11514: `DashboardWidgetSchema['type']` is the widget vocabulary and nothing else.
    // A slot entry is read by the slot's element type, which `plugin-dashboard`'s renderers
    // annotate entries with, so the widget arm no longer has to admit the component type.
    const widgetArm: Equal< NonNullable< DashboardWidgetSchema['type'] >, DashboardWidgetTypeName > = true;
    // The slot's element type still reads a card: its component arm names the component set.
    const element: Equal<
      Extract< DashboardComponentSchema['widgets'][number]['type'], DashboardComponentWidgetType >,
      DashboardComponentWidgetType
    > = true;
    expect([disjoint, widgetArm, element]).toEqual([true, true, true]);
  });

  it('`tsc` refuses a `metric-card` literal with no `value`, as both Zod faces do (objectui#11514)', () => {
    const valuelessCard: DashboardComponentSchema = {
      type: 'dashboard',
      // @ts-expect-error -- the component arm requires `value`, and no other arm names `metric-card`.
      widgets: [{ type: 'metric-card', title: 'Revenue' }],
    };
    for (const [, face] of FACES) expect(face.safeParse(valuelessCard).success).toBe(false);
  });
});
