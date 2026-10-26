/**
 * objectui#11022 — the strict authoring face admits what the widget slot's
 * REGISTRATIONS declare, measured against the live `ComponentRegistry`; and
 * objectui#11467 — the slot arm declares them as MEMBERS, typed as the props
 * `MetricCard` reads.
 *
 * `@object-ui/types` declares, on its private widget-slot arm (and on the
 * TypeScript twin, `DashboardWidgetSlotComponentSchema`), the inputs of each
 * component type in the closed `DASHBOARD_COMPONENT_WIDGET_TYPES`. That package
 * depends on no registry and cannot import `MetricCard`, so the members are
 * transcribed there — and a transcription is only as good as the check that
 * re-reads its source. The sources are here: this package's barrel runs the
 * registration, and `MetricCard` is the component it renders. So this file
 * holds the arm to both, and holds no copy of either:
 *
 *   1. UNDER-admission — every input a widget-slot type's registration
 *      declares parses on `StrictAnyComponentSchema` in the widget slot, with
 *      no `unrecognized_keys` naming it. The population is every member of the
 *      closed set, read from the set, so a member added later is walked too.
 *   2. DECLARED, both directions — every registered input is a member of the
 *      slot arm on both faces, and every member the arm adds to `BaseSchema`
 *      besides `layout` is a registered input. Read off each face's arm, so a
 *      member no registration declares turns this red. Each member is typed as
 *      the registration declares it (`value` required, `trend` its enum), and
 *      the TypeScript arm's members are the types of `MetricCardProps`.
 *
 * The instrument's controls: a key no registration declares is refused by
 * name (so walk 1 can fail), and the population is non-empty and holds the
 * card that motivated the repair.
 *
 *   3. THE SLOT'S `layout` (objectui#11070 round 11) — not a registered input
 *      but a widget key, the spec's widget `layout`, which `DashboardGridLayout`'s
 *      Save Layout (`mergeLayoutIntoSchema`) writes onto every `widgets[]`
 *      entry, a component node included. The producer's own output is parsed
 *      here, so the pin measures what Save Layout writes rather than a
 *      hand-copied shape of it. The slot arm declares the spec's member by
 *      reference, so a malformed `layout` is the control: refused, at
 *      `layout`, on both faces.
 */
import { describe, expect, it } from 'vitest';
import { DashboardWidgetSchema as SpecDashboardWidgetSchema } from '@objectstack/spec/ui';
import { ComponentRegistry } from '@object-ui/core';
import {
  DASHBOARD_COMPONENT_WIDGET_TYPES,
  type DashboardComponentSchema as DashboardComponentNode,
  type DashboardWidgetSlotComponentSchema,
} from '@object-ui/types';
import {
  AnyComponentSchema,
  BaseSchema,
  DashboardComponentSchema,
  deriveStrictAuthoringSchema,
  StrictAnyComponentSchema,
} from '@object-ui/types/zod';
// Side-effect import: the package barrel runs the `ComponentRegistry.register`
// calls, `metric-card`'s among them.
import '../index';
import { mergeLayoutIntoSchema } from '../DashboardGridLayout';
import type { MetricCardProps } from '../MetricCard';

type Issue = { code: string; path: PropertyKey[]; keys?: string[]; errors?: Issue[][] };
type Def = {
  type: string;
  shape?: Record<string, unknown>;
  innerType?: unknown;
  element?: unknown;
  options?: unknown[];
  entries?: Record<string, unknown>;
};
type Input = { name: string; type?: unknown; enum?: Array<{ value: unknown } | string> };
type Equal< A, B > =
  (< T >() => T extends A ? 1 : 2) extends (< T >() => T extends B ? 1 : 2) ? true : false;

const defOf = (schema: unknown): Def => (schema as { _zod: { def: Def } })._zod.def;

/** Every key named by an `unrecognized_keys` issue anywhere in the refusal. */
const unrecognized = (issues: readonly Issue[]): string[] =>
  issues.flatMap((issue) => [
    ...(issue.code === 'unrecognized_keys' ? (issue.keys ?? []) : []),
    ...(issue.errors ?? []).flatMap((group) => unrecognized(group)),
  ]);

/** A value of the input's registered kind — the key is what is measured, not the value. */
const sampleFor = (input: Input): unknown => {
  if (input.type === 'enum' && input.enum?.length) {
    const first = input.enum[0];
    return typeof first === 'string' ? first : first.value;
  }
  if (input.type === 'number') return 1;
  if (input.type === 'boolean') return true;
  return 'sample';
};

const dashboard = (widget: Record<string, unknown>) => ({ type: 'dashboard', widgets: [widget] });

// Read in the `plugin-dashboard` namespace: since objectui#10859 batch 8 the
// slot components register with `skipFallback: true`, so the registration a
// slot entry renders through is `plugin-dashboard:TYPE`, never a bare key.
const registeredInputs = (type: string): Input[] =>
  (ComponentRegistry.getConfig(type, 'plugin-dashboard')?.inputs ?? []) as Input[];

/** The widget slot's component-node arm: the union option whose `type` is the closed set. */
const slotArm = (dashboardSchema: unknown): unknown => {
  let widgets = defOf(dashboardSchema).shape?.widgets;
  while (defOf(widgets).innerType) widgets = defOf(widgets).innerType;
  const options = defOf(defOf(widgets).element).options ?? [];
  const arm = options.find((option) => {
    const type = defOf(defOf(option).shape?.type);
    return type.type === 'enum';
  });
  if (!arm) throw new Error('no component-node arm found in the widget slot — the slot moved; re-read it before trusting this file');
  return arm;
};

describe('objectui#11022 — widget-slot registrations vs the strict authoring face', () => {
  it('the population is the closed set, and it is not empty', () => {
    expect(DASHBOARD_COMPONENT_WIDGET_TYPES).toContain('metric-card');
    for (const type of DASHBOARD_COMPONENT_WIDGET_TYPES) {
      expect(registeredInputs(type).length, `\`${type}\` has no registered inputs to walk`).toBeGreaterThan(0);
    }
    // The registration the defect was measured on: `value` is its REQUIRED input.
    expect(registeredInputs('metric-card').find((i) => i.name === 'value')).toMatchObject({ required: true });
  });

  describe.each([...DASHBOARD_COMPONENT_WIDGET_TYPES])('`%s`', (type) => {
    it.each(registeredInputs(type).map((input) => [input.name, input] as const))(
      'UNDER-admission: its registered input `%s` parses in the widget slot on the strict face',
      (name, input) => {
        // On a node that carries the REQUIRED inputs (`value`, since objectui#11467), so
        // each optional input is measured on a card the arm otherwise accepts.
        const result = StrictAnyComponentSchema.safeParse(dashboard({ ...nodeOf(type), [name]: sampleFor(input) }));
        const issues = result.success ? [] : (result.error.issues as unknown as Issue[]);
        expect(unrecognized(issues), `the strict face refuses the registered input \`${name}\``).not.toContain(name);
        expect(result.success).toBe(true);
      },
    );

    it('CONTROL — a key no registration declares is refused by name', () => {
      const result = StrictAnyComponentSchema.safeParse(dashboard({ type, notARegisteredInput11022: 1 }));
      expect(result.success).toBe(false);
      expect(unrecognized(result.success ? [] : (result.error.issues as unknown as Issue[]))).toContain(
        'notARegisteredInput11022',
      );
    });
  });

  it('DECLARED, both directions, on both faces: every registered input is a member of the slot arm, and every member it adds beyond the base and `layout` is a registered input', () => {
    // objectui#11467: the inputs are the arm's MEMBERS, so the strict face admits
    // them by its ordinary rule (a member is declared) and both faces judge each
    // value by its member. Until then the arm declared none of them and the
    // strict face admitted their names from a side table in `@object-ui/types`.
    const baseKeys = new Set(Object.keys(defOf(BaseSchema).shape ?? {}));
    const registered = new Set(
      DASHBOARD_COMPONENT_WIDGET_TYPES.flatMap((type) => registeredInputs(type).map((input) => input.name)),
    );
    for (const face of [DashboardComponentSchema, deriveStrictAuthoringSchema(DashboardComponentSchema)]) {
      const armKeys = Object.keys(defOf(slotArm(face)).shape ?? {});
      // UNDER: nothing registered is left to the passthrough (the base's own
      // `description` counts — it is a member the arm inherits).
      expect([...registered].filter((name) => !armKeys.includes(name))).toEqual([]);
      // OVER: what the arm adds to the base is the slot's `layout` and registered inputs only.
      const added = armKeys.filter((key) => !baseKeys.has(key) && key !== 'layout').sort();
      // Non-vacuity: the arm does declare an input the base lacks.
      expect(added).toContain('value');
      expect(
        added.filter((key) => !registered.has(key)),
        'the slot arm declares a member no widget-slot registration declares — remove it from '
          + '`DashboardWidgetSlotComponentSchema` in `@object-ui/types`, or register it first',
      ).toEqual([]);
    }
  });

  it('each member is typed as the registration declares it: `value` required, and `trend` exactly the registered enum', () => {
    const shape = defOf(slotArm(DashboardComponentSchema)).shape ?? {};
    const value = registeredInputs('metric-card').find((input) => input.name === 'value') as Input & { required?: boolean };
    expect(value.required).toBe(true);
    expect(defOf(shape.value).type, '`value` is required on the arm, as on the registration').not.toBe('optional');
    const trend = registeredInputs('metric-card').find((input) => input.name === 'trend');
    const enumValues = (trend?.enum ?? []).map((entry) => (typeof entry === 'string' ? entry : entry.value)).sort();
    // Non-vacuity: the registration does declare an enum.
    expect(enumValues.length).toBeGreaterThan(0);
    let member = shape.trend;
    while (defOf(member).innerType) member = defOf(member).innerType;
    expect(Object.values(defOf(member).entries ?? {}).sort()).toEqual(enumValues);
  });

  it('the TypeScript arm declares each input as the type of the prop `MetricCard` reads it as', () => {
    // `MetricCard` is what `plugin-dashboard:metric-card` renders. The arm in
    // `@object-ui/types` cannot import it, so the parity is pinned here, where
    // both are visible; `tsc -p tsconfig.test.json` is the reader of this line.
    type Inputs = 'title' | 'value' | 'icon' | 'trend' | 'trendValue' | 'description';
    const sameTypes: Equal< Pick<DashboardWidgetSlotComponentSchema, Inputs>, Pick<MetricCardProps, Inputs> > = true;
    expect(sameTypes).toBe(true);
  });
});

/** Every issue in the refusal, union arms flattened, each path made absolute to the widget. */
const flatIssues = (issues: readonly Issue[], prefix: PropertyKey[] = []): Issue[] =>
  issues.flatMap((issue) => [
    { ...issue, path: [...prefix, ...issue.path] },
    ...(issue.errors ?? []).flatMap((group) => flatIssues(group, [...prefix, ...issue.path])),
  ]);

/**
 * A node of `type` carrying each REQUIRED registered input, so only `layout` is under test.
 * The inputs are read from the live registration, which the compiler cannot see, so the
 * cast names what they supply: the arm's required `value` (objectui#11467), which the
 * population test above pins as the registration's `required` input. Both faces then
 * judge the node at runtime.
 */
const nodeOf = (type: string): DashboardWidgetSlotComponentSchema => ({
  type: type as DashboardWidgetSlotComponentSchema['type'],
  id: `kpi-${type}`,
  ...(Object.fromEntries(
    registeredInputs(type)
      .filter((input) => (input as Input & { required?: boolean }).required)
      .map((input) => [input.name, sampleFor(input)]),
  ) as Pick<DashboardWidgetSlotComponentSchema, 'value'>),
});

/** What Save Layout persists: the producer's merge of grid coordinates into the dashboard. */
const savedLayout = (node: DashboardWidgetSlotComponentSchema): DashboardComponentNode =>
  mergeLayoutIntoSchema({ type: 'dashboard', widgets: [node] }, [
    { i: node.id ?? '', x: 0, y: 0, w: 3, h: 2 },
  ]);

describe('objectui#11070 round 11 — the slot\'s `layout`, as Save Layout writes it, on the strict face', () => {
  describe.each([...DASHBOARD_COMPONENT_WIDGET_TYPES])('`%s`', (type) => {
    it('the producer writes `layout` onto the component node — the population is real', () => {
      const saved = savedLayout(nodeOf(type));
      expect(saved.widgets[0]).toMatchObject({ type, layout: { x: 0, y: 0, w: 3, h: 2 } });
    });

    it('the saved dashboard parses on the strict face, and `layout` is not named', () => {
      const result = StrictAnyComponentSchema.safeParse(savedLayout(nodeOf(type)));
      const issues = result.success ? [] : (result.error.issues as unknown as Issue[]);
      expect(unrecognized(issues), 'the strict face refuses the `layout` Save Layout wrote').not.toContain('layout');
      expect(result.success).toBe(true);
      // Control: the tolerant face accepts the same document — the two faces agree.
      expect(AnyComponentSchema.safeParse(savedLayout(nodeOf(type))).success).toBe(true);
    });

    it.each([
      ['a non-number coordinate', { x: 'left', y: 0, w: 3, h: 2 }, ['layout', 'x']],
      ['a missing coordinate', { x: 0, y: 0, w: 3 }, ['layout', 'h']],
      ['a key the spec does not declare', { x: 0, y: 0, w: 3, h: 2, z: 1 }, ['layout']],
    ] as const)('CONTROL — %s in `layout` is refused at `layout`, on both faces', (_label, layout, path) => {
      const doc = { type: 'dashboard', widgets: [{ ...nodeOf(type), layout }] };
      for (const face of [StrictAnyComponentSchema, AnyComponentSchema]) {
        const result = face.safeParse(doc);
        expect(result.success).toBe(false);
        const union = (result.success ? [] : (result.error.issues as unknown as Issue[])).find(
          (issue) => issue.code === 'invalid_union' && issue.path.join('.') === 'widgets.0',
        );
        // The COMPONENT arm's own verdict — the union's first arm — not the widget
        // arm's, which has always judged `layout` and would answer for it otherwise.
        const componentArm = flatIssues(union?.errors?.[0] ?? []);
        expect(componentArm.map((issue) => issue.path.join('.'))).toContain(path.join('.'));
      }
    });
  });

  it('both arms carry the spec\'s widget `layout` — one shape, read off the spec, not restated', () => {
    let widgets = defOf(DashboardComponentSchema).shape?.widgets;
    while (defOf(widgets).innerType) widgets = defOf(widgets).innerType;
    const arms = defOf(defOf(widgets).element).options ?? [];
    type Member = { safeParse: (value: unknown) => { success: boolean } };
    // Each probe value, judged by the spec's member and by each arm's: the verdicts must agree.
    const probes: unknown[] = [
      undefined,
      { x: 0, y: 0, w: 3, h: 2 },
      { x: 0, y: 0, w: 3 },
      { x: 'left', y: 0, w: 3, h: 2 },
      { x: 0, y: 0, w: 3, h: 2, z: 1 },
      'top',
    ];
    const verdicts = (member: Member) => probes.map((value) => member.safeParse(value).success);
    const spec = verdicts(SpecDashboardWidgetSchema.shape.layout as unknown as Member);
    // Non-vacuity: the spec's member accepts and refuses something in the probe set.
    expect(spec).toContain(true);
    expect(spec).toContain(false);
    expect(arms).toHaveLength(2);
    for (const arm of arms) {
      const layout = defOf(arm).shape?.layout as Member | undefined;
      expect(layout, 'a widget-slot arm declares no `layout`').toBeDefined();
      expect(verdicts(layout as Member)).toEqual(spec);
    }
  });

  it('the TypeScript face: the arm types `layout` by the spec\'s shape, not the index signature\'s `any`', () => {
    const placed: DashboardWidgetSlotComponentSchema = { type: 'metric-card', value: '1', layout: { x: 0, y: 0, w: 3, h: 2 } };
    // @ts-expect-error -- `x` is a number in the spec's widget `layout`.
    const misplaced: DashboardWidgetSlotComponentSchema = { type: 'metric-card', value: '1', layout: { x: 'left', y: 0, w: 3, h: 2 } };
    expect([placed.layout?.w, misplaced.type]).toEqual([3, 'metric-card']);
  });
});

/**
 * objectui#11483 — the registration's `required` and the schema agree IN THE SLOT.
 *
 * The arm declared `value` required since objectui#11467, and the walk above holds
 * that member to the registration. The slot still disagreed: its widget arm's
 * `type` vocabulary named `metric-card`, so a card carrying no card-only input
 * parsed as a widget and the arm's requirement governed nothing. This walk reads
 * every REQUIRED input off the live registration and drops it from an otherwise
 * complete node, so it measures the slot's verdict, not the arm's member.
 */
describe('objectui#11483 — a widget-slot registration\'s required inputs are required in the slot', () => {
  describe.each([...DASHBOARD_COMPONENT_WIDGET_TYPES])('`%s`', (type) => {
    const required = (): Input[] =>
      registeredInputs(type).filter((input) => (input as Input & { required?: boolean }).required);

    it('the registration declares a required input — the walk below is not empty', () => {
      expect(required().length).toBeGreaterThan(0);
    });

    it('CONTROL — the node carrying every required input parses in the slot on both faces', () => {
      for (const face of [AnyComponentSchema, StrictAnyComponentSchema]) {
        expect(face.safeParse(dashboard({ ...nodeOf(type) })).success).toBe(true);
      }
    });

    it('a node missing any required input is refused in the slot on both faces, by the component arm at that input', () => {
      for (const input of required()) {
        const node: Record<string, unknown> = { ...nodeOf(type), title: 'Revenue' };
        delete node[input.name];
        for (const face of [AnyComponentSchema, StrictAnyComponentSchema]) {
          const result = face.safeParse(dashboard(node));
          expect(result.success, `\`${input.name}\` is required by the registration`).toBe(false);
          const union = (result.success ? [] : (result.error.issues as unknown as Issue[])).find(
            (issue) => issue.code === 'invalid_union' && issue.path.join('.') === 'widgets.0',
          );
          const componentArm = flatIssues(union?.errors?.[0] ?? []);
          expect(componentArm.map((issue) => issue.path.join('.'))).toContain(input.name);
        }
      }
    });
  });
});
