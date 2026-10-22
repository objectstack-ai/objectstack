// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #5068 — the SDUI component-props gate.
//
// The hole this closes was measured through the SAME door the fix uses, before
// the rule was wired: `runAuthoringRules('validate', …)` on a page carrying
// `properties: { title: 'T', titel: 'typo' }` reported ZERO findings — from the
// whole registry, not just from this rule. Same for a wrongly-typed prop and
// for a misspelled key one layer down inside `fields[]`. The two probes that
// must stay silent (an unregistered `type`, and `readonly` — declared at #5176)
// reported zero in both states, which is what makes the other three mean
// something.
import { describe, expect, it } from 'vitest';
import { normalizeStackInput } from '@objectstack/spec';
import { ComponentPropsMap, PageSchema } from '@objectstack/spec/ui';
import {
  validateComponentProps as validateComponentPropsUnrecorded,
  COMPONENT_PROPS_UNKNOWN_KEY,
  COMPONENT_PROPS_INVALID,
  DATA_SOURCE_BOUND_ELEMENT_TYPES,
} from './validate-component-props.js';
import { runAuthoringRules, AUTHORING_RULES } from './authoring-rules.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Slice 21: every finding this file fires is recorded, and the block at
// the foot of the file holds each recorded `component-props-invalid` `fix:` line
// to one line of at most 200 characters.
const fired: Array<{ rule: string; hint: string; where: string }> = [];
const validateComponentProps: typeof validateComponentPropsUnrecorded = (...args) => {
  const findings = validateComponentPropsUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

type AnyRec = Record<string, unknown>;

/** One page, one region, the given components. */
const stackWith = (components: unknown[], pageExtra: AnyRec = {}): AnyRec => ({
  pages: [
    {
      name: 'probe_page',
      label: 'Probe',
      type: 'home',
      object: 'task',
      regions: [{ name: 'main', components }],
      ...pageExtra,
    },
  ],
});

const unknownKeys = (f: ReturnType<typeof validateComponentProps>) =>
  f.filter((x) => x.rule === COMPONENT_PROPS_UNKNOWN_KEY);
const invalid = (f: ReturnType<typeof validateComponentProps>) =>
  f.filter((x) => x.rule === COMPONENT_PROPS_INVALID);

describe('validateComponentProps — undeclared keys', () => {
  it('reports a key the type\'s props schema does not declare, with the near-miss named', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'page:header', properties: { title: 'T', titel: 'typo' } }]),
    );
    expect(unknownKeys(findings)).toHaveLength(1);
    const [f] = unknownKeys(findings);
    expect(f.severity).toBe('error');
    expect(f.path).toBe('pages[0].regions[0].components[0].properties.titel');
    expect(f.where).toBe('page "probe_page" · page:header');
    // ⚠️ The rename PHRASING moved at #4001 batch A and the assertion follows
    // the fact rather than the wording: a strip-mode shape got the walker's
    // `Did you mean \`title\`?`, a `strictObject` gets its error map's
    // `Did you mean \`titel\` → \`title\`?` — which echoes the offending
    // spelling as well as the fix. Asserted as both spellings present, so this
    // pin measures the diagnostic's content rather than which of the two
    // channels produced it.
    expect(f.message).toContain('`titel`');
    expect(f.message).toContain('`title`');
    expect(f.message).toContain('Did you mean');
  });

  it('is silent on a fully declared props bag', () => {
    const findings = validateComponentProps(
      stackWith([
        { type: 'page:header', properties: { title: 'T', subtitle: 'S', recordChrome: false } },
        {
          type: 'record:related_list',
          properties: { objectName: 'task', relationshipField: 'project_id', limit: 5 },
        },
      ]),
    );
    expect(findings).toEqual([]);
  });

  // #20758 — `PageHeaderProps.breadcrumb` is a retiredKey tombstone. This rule
  // is the door where an author meets the prescription, and since #23026 a
  // retired key is the one class it refuses: an ERROR, whatever the value.
  it('refuses a retired page-header `breadcrumb` as an error carrying the prescription, for `true` and `false`', () => {
    for (const breadcrumb of [true, false]) {
      const findings = validateComponentProps(
        stackWith([{ type: 'page:header', properties: { title: 'T', breadcrumb } }]),
      );
      expect(findings, `breadcrumb: ${breadcrumb}`).toHaveLength(1);
      const [f] = findings;
      expect(f.severity).toBe('error');
      expect(f.path).toBe('pages[0].regions[0].components[0].properties.breadcrumb');
      expect(f.message).toContain('`page:header` property `breadcrumb` was removed in @objectstack/spec 17');
    }
  });

  // #23650 — `PageHeaderProps.showStar` is a retiredKey tombstone, the
  // `breadcrumb` route one key over: the reference console draws no star, and
  // the record's favorites entry is the header's ⋯ menu. It replaces the
  // acceptance this file used to pin for `showStar: false` (#6776, below).
  it('refuses a retired page-header `showStar` as an error carrying the prescription, for `true` and `false`', () => {
    for (const showStar of [true, false]) {
      const findings = validateComponentProps(
        stackWith([{ type: 'page:header', properties: { title: 'T', showStar, showCopyId: false } }]),
      );
      expect(findings, `showStar: ${showStar}`).toHaveLength(1);
      const [f] = findings;
      expect(f.rule).toBe('component-props-invalid');
      expect(f.severity).toBe('error');
      expect(f.path).toBe('pages[0].regions[0].components[0].properties.showStar');
      expect(f.message).toContain('`page:header` property `showStar` was removed in @objectstack/spec 18');
      expect(f.message).toContain('the record\'s favorites entry is the header\'s ⋯ menu, and metadata does not control it');
    }
  });

  // #24394 — a page action row's own `patch` is a retiredKey tombstone on every
  // row: the row's `operation: 'update'` runs the declared action its `name`
  // names, and the platform action route writes THAT action's `patch`.
  it('refuses a page action row `patch` as an error carrying the prescription, on each node and member', () => {
    const PATCH = { status: 'done' };
    const cases: ReadonlyArray<readonly [unknown, string, string]> = [
      [{ type: 'action:button', properties: { label: 'Close', name: 'close_task', operation: 'update', patch: PATCH } },
        'properties.patch', "An `action:button`'s `patch` was removed in @objectstack/spec 18"],
      [{ type: 'action:icon', properties: { icon: 'check', name: 'close_task', operation: 'update', patch: PATCH } },
        'properties.patch', "An `action:icon`'s `patch` was removed in @objectstack/spec 18"],
      [{ type: 'action:group', properties: { actions: [{ label: 'Close', name: 'close_task', operation: 'update', patch: PATCH }] } },
        'properties.actions.0.patch', "An `action:group` or `action:menu` member's `patch` was removed in @objectstack/spec 18"],
      [{ type: 'action:menu', properties: { actions: [{ label: 'Close', name: 'close_task', operation: 'update', patch: PATCH }] } },
        'properties.actions.0.patch', "An `action:group` or `action:menu` member's `patch` was removed in @objectstack/spec 18"],
    ];
    for (const [component, at, opening] of cases) {
      const findings = validateComponentProps(stackWith([component]));
      expect(findings, at).toHaveLength(1);
      const [f] = findings;
      expect(f.rule).toBe('component-props-invalid');
      expect(f.severity).toBe('error');
      expect(f.path).toBe(`pages[0].regions[0].components[0].${at}`);
      expect(f.message).toContain(opening);
      expect(f.message).toContain("Move the values into the `patch` of the action the row's `name` names");
    }
  });

  it("refuses a page action row's `operation: 'update'` with no `name` at `name`, and accepts it with one", () => {
    const nameless = validateComponentProps(stackWith([{ type: 'action:button', properties: { label: 'Close', operation: 'update' } }]));
    expect(nameless.map((f) => [f.rule, f.path])).toEqual([
      ['component-props-invalid', 'pages[0].regions[0].components[0].properties.name'],
    ]);
    const named = validateComponentProps(
      stackWith([{ type: 'action:button', properties: { label: 'Close', name: 'close_task', operation: 'update' } }]),
    );
    expect(named).toEqual([]);
  });

  // #21589 — an `object-master-detail-form` detail entry's `sortField` is a
  // retiredKey tombstone, one array level down. The same door and, since
  // #23026, the same refusal: an error that names the entry's key.
  it('refuses a retired detail-entry `sortField` as an error carrying the prescription, at the entry\'s key', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'object-master-detail-form',
          properties: {
            objectName: 'invoice',
            details: [
              { title: 'Payments', childObject: 'invoice_payment' },
              { title: 'Lines', childObject: 'invoice_line', sortField: 'line_no' },
            ],
          },
        },
      ]),
    );
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe('error');
    expect(f.rule).toBe(COMPONENT_PROPS_INVALID);
    expect(f.path).toBe('pages[0].regions[0].components[0].properties.details.1.sortField');
    expect(f.message).toContain('`object-master-detail-form` property `details[].sortField` was removed in @objectstack/spec 17');
  });

  it('walks components nested inside `properties` (tabs items → children)', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'page:tabs',
          properties: {
            items: [
              {
                label: 'Detail',
                children: [{ type: 'record:highlights', properties: { fields: ['status'], layuot: 'vertical' } }],
              },
            ],
          },
        },
      ]),
    );
    expect(unknownKeys(findings).map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.items[0].children[0].properties.layuot',
    ]);
  });

  it('skips a page whose components are a derived cache of authored `source`', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'page:header', properties: { titel: 'typo' } }], { kind: 'react', source: 'x' }),
    );
    expect(findings).toEqual([]);
  });
});

/**
 * The second layer, and why it needs its own pins (#5607's correction).
 *
 * `readonly` is not a key on `RecordHighlightsProps`. It lives one level down,
 * on the OBJECT ARM of the `RecordHighlightsField` union that `fields[]` holds
 * — and the authorable-surface walk is strictly one level deep, so it never
 * collects it. #5176 declared the key precisely because objectui's HeaderHighlight
 * gate already honours it; a gate that could not see layer 2 would have gone on
 * reporting it as undeclared and told authors to delete a live key.
 *
 * Both directions are pinned, because only the pair proves the walk descends:
 * the declared spelling must stay SILENT (or the gate over-reports a live key)
 * and a near-miss must be REPORTED (or the silence is just the walk stopping at
 * `fields`, which passes for the wrong reason).
 */
describe('validateComponentProps — the second layer (union arm below an array)', () => {
  it('accepts `readonly` on a highlights field object (#5176) — both verdicts clean', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'record:highlights',
          properties: { fields: ['owner', { name: 'status', label: 'Status', readonly: true }] },
        },
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('reports a near-miss of it (`readOnly`) at layer 2, naming the declared spelling', () => {
    const findings = validateComponentProps(
      stackWith([
        { type: 'record:highlights', properties: { fields: [{ name: 'status', readOnly: true }] } },
      ]),
    );
    expect(unknownKeys(findings)).toHaveLength(1);
    expect(unknownKeys(findings)[0].path).toBe(
      'pages[0].regions[0].components[0].properties.fields.0.readOnly',
    );
    // Same phrasing move as above (#4001 batch A) — content, not wording.
    expect(unknownKeys(findings)[0].message).toContain('`readOnly`');
    expect(unknownKeys(findings)[0].message).toContain('`readonly`');
    expect(unknownKeys(findings)[0].message).toContain('Did you mean');
  });

  it('leaves a bare string field name alone (the union\'s other arm)', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'record:highlights', properties: { fields: ['status'] } }]),
    );
    expect(findings).toEqual([]);
  });
});

describe('validateComponentProps — value verdicts', () => {
  it('reports a wrongly-typed prop and echoes what was written', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'record:related_list',
          properties: { objectName: 'task', relationshipField: 'p', limit: 'five' },
        },
      ]),
    );
    expect(invalid(findings)).toHaveLength(1);
    expect(invalid(findings)[0].severity).toBe('error');
    expect(invalid(findings)[0].path).toBe('pages[0].regions[0].components[0].properties.limit');
    expect(invalid(findings)[0].message).toContain('expected number, received string');
  });

  it('reports a missing required prop', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'record:related_list', properties: { objectName: 'task' } }]),
    );
    expect(invalid(findings).map((f) => f.path)).toContain(
      'pages[0].regions[0].components[0].properties.relationshipField',
    );
  });

  /**
   * [#22212] A NESTED component with NO `properties` bag at all. The top-level
   * firing control parses through `PageComponentSchema`, whose default makes the
   * absent bag `{}`; a nested node sits in an untyped slot and never gets that
   * default, so it reached this rule as `undefined` and was skipped — measured
   * on nested `record:related_list`, `page:accordion` and `element:text` in the
   * reporting app. The control and the probe are the same node, one level apart.
   */
  describe('a nested component whose `properties` are absent (#22212)', () => {
    const required = (f: ReturnType<typeof validateComponentProps>) => invalid(f).map((x) => x.path);

    it('the firing control: a top-level node with an empty bag reports its required props', () => {
      expect(required(validateComponentProps(stackWith([{ type: 'record:related_list', properties: {} }]))))
        .toContain('pages[0].regions[0].components[0].properties.relationshipField');
    });

    it('the parsed door: the top-level node with NO bag reports the same (the schema default)', () => {
      const parsed = normalizeStackInput(stackWith([{ type: 'record:related_list' }])) as AnyRec;
      expect(required(validateComponentProps(parsed)))
        .toContain('pages[0].regions[0].components[0].properties.relationshipField');
    });

    it.each([
      ['a container\'s `children`', { type: 'page:section', properties: { children: [{ type: 'record:related_list' }] } },
        'pages[0].regions[0].components[0].properties.children[0].properties.relationshipField'],
      ['a tab panel\'s `items[].children`',
        { type: 'page:tabs', properties: { items: [{ label: 'T', value: 't', children: [{ type: 'record:related_list' }] }] } },
        'pages[0].regions[0].components[0].properties.items[0].children[0].properties.relationshipField'],
    ])('the probe: a nested node with NO bag in %s reports the same required prop', (_label, node, path) => {
      expect(required(validateComponentProps(stackWith([node])))).toContain(path);
    });

    it('a nested node whose required props are all optional stays silent with no bag', () => {
      expect(validateComponentProps(
        stackWith([{ type: 'page:section', properties: { children: [{ type: 'page:header' }] } }]),
      )).toEqual([]);
    });
  });

  /**
   * [#24991] A NESTED component whose `properties` is PRESENT but not a record.
   * `PageComponentSchema` refuses that bag on a top-level node ("expected
   * record"), but a nested node sits in a `z.array(z.unknown())` slot that no
   * parse reaches, and this rule used to skip it — `null` and `[]` were measured
   * passing `lint --strict` on nested `record:related_list` and `object-metric`
   * in the reporting app. The bag is refused at the node's `properties` path,
   * once, with no per-prop verdicts beside it.
   */
  describe('a nested component whose `properties` is present but not a record (#24991)', () => {
    const shape = (f: ReturnType<typeof validateComponentProps>) => f.map((x) => [x.rule, x.severity, x.path]);
    const RELATED = (properties: unknown) => ({ type: 'record:related_list', properties });

    /** The walks #22212 covers, plus a `page:card` footer and a slot's sub-tree. */
    const WALKS: Array<[string, (child: unknown) => AnyRec, string]> = [
      ['a container\'s `children`', (child) => stackWith([{ type: 'page:section', properties: { children: [child] } }]),
        'pages[0].regions[0].components[0].properties.children[0].properties'],
      ['a tab panel\'s `items[].children`',
        (child) => stackWith([{ type: 'page:tabs', properties: { items: [{ label: 'T', value: 't', children: [child] }] } }]),
        'pages[0].regions[0].components[0].properties.items[0].children[0].properties'],
      ['an accordion panel\'s `items[].children`',
        (child) => stackWith([{ type: 'page:accordion', properties: { items: [{ label: 'A', children: [child] }] } }]),
        'pages[0].regions[0].components[0].properties.items[0].children[0].properties'],
      ['a card\'s `footer`', (child) => stackWith([{ type: 'page:card', properties: { footer: [child] } }]),
        'pages[0].regions[0].components[0].properties.footer[0].properties'],
      ['a slot component\'s `children`',
        (child) => ({ pages: [{ name: 'probe_page', label: 'Probe', type: 'record', object: 'task', kind: 'slotted',
          slots: { details: [{ type: 'page:section', properties: { children: [child] } }] } }] }),
        'pages[0].slots.details[0].properties.children[0].properties'],
    ];
    const BAGS: Array<[string, unknown, string]> = [
      ['null', null, '`null`'],
      ['an array', [], 'an array'],
      ['a scalar', 'x', 'a string'],
    ];

    describe.each(WALKS)('in %s', (_walk, wrap, path) => {
      it.each(BAGS)('a %s bag draws one `component-props-invalid` error at the node\'s `properties`', (_l, bag, received) => {
        const findings = validateComponentProps(wrap(RELATED(bag)));
        expect(shape(findings)).toEqual([[COMPONENT_PROPS_INVALID, 'error', path]]);
        expect(findings[0]!.message).toContain(`received ${received}`);
      });

      it('control: the same node with a valid bag stays silent', () => {
        expect(validateComponentProps(wrap(RELATED({ objectName: 'task', relationshipField: 'project' })))).toEqual([]);
      });

      it('control: the same node with NO bag keeps its #22212 verdict (judged as `{}`)', () => {
        const paths = invalid(validateComponentProps(wrap({ type: 'record:related_list' }))).map((f) => f.path);
        expect(paths).toContain(`${path}.relationshipField`);
        expect(paths).not.toContain(path);
      });
    });

    it('`object-metric` nested with `properties: []` — the third measured probe', () => {
      const findings = validateComponentProps(stackWith([{ type: 'page:section', properties: { children: [{ type: 'object-metric', properties: [] }] } }]));
      expect(shape(findings)).toEqual([[COMPONENT_PROPS_INVALID, 'error', 'pages[0].regions[0].components[0].properties.children[0].properties']]);
    });

    it('an unregistered type is refused too: the bag\'s shape is the node\'s contract, not a props schema\'s', () => {
      const findings = validateComponentProps(stackWith([{ type: 'page:section', properties: { children: [{ type: 'flex', properties: null }] } }]));
      expect(shape(findings)).toEqual([[COMPONENT_PROPS_INVALID, 'error', 'pages[0].regions[0].components[0].properties.children[0].properties']]);
      // Control: the same unregistered node with an object bag is still skipped.
      expect(validateComponentProps(stackWith([{ type: 'page:section', properties: { children: [{ type: 'flex', properties: { anything: 1 } }] } }]))).toEqual([]);
    });

    it('a data-source-bound element with a malformed bag and no binding draws both node verdicts, nothing more', () => {
      const findings = validateComponentProps(stackWith([{ type: 'page:section', properties: { children: [{ type: 'element:repeater', properties: null }] } }]));
      expect(shape(findings).sort()).toEqual([
        [COMPONENT_PROPS_INVALID, 'error', 'pages[0].regions[0].components[0].properties.children[0].dataSource.object'],
        [COMPONENT_PROPS_INVALID, 'error', 'pages[0].regions[0].components[0].properties.children[0].properties'],
      ]);
    });

    it('top level: the page parse refuses the bag first, and the rule given the raw node answers the same verdict', () => {
      // The page parse owns the top-level shape — and only that one: the
      // nested node's bag passes it untouched, which is the whole gap.
      const top = PageSchema.safeParse((stackWith([RELATED(null)]).pages as AnyRec[])[0]);
      expect(top.success).toBe(false);
      expect(top.error!.issues.map((i) => i.path.join('.'))).toContain('regions.0.components.0.properties');
      const nested = PageSchema.safeParse((stackWith([{ type: 'page:section', properties: { children: [RELATED(null)] } }]).pages as AnyRec[])[0]);
      expect(nested.success).toBe(true);
      // An unparsed caller gets one finding, not one per required prop.
      expect(shape(validateComponentProps(stackWith([RELATED(null)])))).toEqual([
        [COMPONENT_PROPS_INVALID, 'error', 'pages[0].regions[0].components[0].properties'],
      ]);
    });

    it('gates through the shared pipeline at `error`, the rule\'s existing class (#23147)', () => {
      for (const command of ['validate', 'lint', 'build'] as const) {
        const mine = runAuthoringRules(command, {
          normalized: stackWith([{ type: 'page:section', properties: { children: [RELATED(null)] } }]) as never,
        }).filter((f) => f.rule.startsWith('component-props'));
        expect(mine.map((f) => [f.rule, f.severity]), command).toEqual([[COMPONENT_PROPS_INVALID, 'error']]);
      }
    });
  });

  /**
   * #7702 — `PageHeaderProps.title` used to be required while the platform's
   * own synthesizer (objectui `buildDefaultHeader`) emits every seeded
   * `page:header` with NO `title` at all: `{ type: 'page:header', recordChrome
   * }`. `validateComponentProps` (this rule) would therefore flag the
   * platform's own default header as `component-props-invalid` on every
   * synthesized record page. Maintainer ruling 2026-08-11: `title` is
   * optional. This pins the exact synthesized shape as clean — no `invalid`
   * finding for a missing `title`, ever.
   */
  it('does not flag the synthesized page:header (no title) as invalid (#7702)', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'page:header', properties: { recordChrome: true } }]),
    );
    expect(
      invalid(findings).filter((f) => f.path.endsWith('.properties.title')),
    ).toEqual([]);
    expect(findings).toEqual([]);
  });

  /**
   * #11509 (v18, ruling A-narrow) — the waiver turned into a refusal. This
   * rule used to WAIVE the props schema's required flat `object` whenever the
   * node's `dataSource.object` was present, for every type alike; the flat
   * binding keys of the three data-source-bound elements are retired now, and
   * the requirement sits on the binding the renderers actually read. One of
   * the three with no `dataSource.object` is a `component-props-invalid`
   * error AT that path — the rule's existing finding, not a new rule.
   */
  describe('the data-source-bound elements owe `dataSource.object` (#11509)', () => {
    const BOUND = ['element:record_picker', 'element:number', 'element:repeater'] as const;
    /** The props each element needs to parse clean on its own, binding aside. */
    const PROPS: Record<(typeof BOUND)[number], Record<string, unknown>> = {
      'element:record_picker': { labelField: 'name' },
      'element:number': { aggregate: 'count' },
      'element:repeater': { titleField: 'subject' },
    };

    it.each(BOUND)('%s with its object on the binding: no finding', (type) => {
      const findings = validateComponentProps(
        stackWith([{ type, dataSource: { object: 'deal' }, properties: PROPS[type] }]),
      );
      expect(findings).toEqual([]);
    });

    it.each(BOUND)('%s with no binding: one finding, at `dataSource.object`', (type) => {
      const findings = validateComponentProps(stackWith([{ type, properties: PROPS[type] }]));
      expect(findings.map((f) => [f.rule, f.path, f.severity])).toEqual([
        [COMPONENT_PROPS_INVALID, 'pages[0].regions[0].components[0].dataSource.object', 'error'],
      ]);
      expect(findings[0]!.message).toContain(`\`${type}\` reads its records from the node-level \`dataSource\` binding`);
      expect(findings[0]!.hint).toContain('dataSource: {');
    });

    it.each([
      ['a binding with no object', { view: 'hot_deals' }],
      ['an empty object name', { object: '' }],
      ['a non-string object', { object: 7 }],
    ])('a binding that names no object (%s) is the same finding', (_label, dataSource) => {
      const findings = validateComponentProps(
        stackWith([{ type: 'element:number', dataSource, properties: { aggregate: 'count' } }]),
      );
      expect(invalid(findings).map((f) => f.path)).toEqual([
        'pages[0].regions[0].components[0].dataSource.object',
      ]);
    });

    it('a node with no `properties` bag at all is judged too — the binding is a key of the node', () => {
      const findings = validateComponentProps(stackWith([{ type: 'element:repeater' }]));
      expect(invalid(findings).map((f) => f.path)).toEqual([
        'pages[0].regions[0].components[0].dataSource.object',
      ]);
    });

    it('control: an element outside the set owes no binding, and the old waiver is gone with the flat `object`', () => {
      // `element:metadata_viewer` declares an `object` of its own (the metadata
      // owner), unrelated to any binding — no binding is required of it.
      const findings = validateComponentProps(
        stackWith([
          { type: 'element:text', properties: { content: 'Hi' } },
          { type: 'element:metadata_viewer', properties: { type: 'flow', name: 'approve_deal' } },
        ]),
      );
      expect(findings).toEqual([]);
    });

    /**
     * THE REPEATER TRAP, closed from both sides. Before: a repeater bound only
     * through `dataSource` passed this rule (the type-blind waiver) while its
     * renderer read the flat keys alone and drew "No records"; the measured
     * reading was 0 findings against the control's 1. After: that node is the
     * clean shape (the renderer reads the binding, objectui#11880), and the
     * node the old renderer DID read — a flat `object` — is refused twice: the
     * tombstone at the key, with its prescription, and the missing binding.
     */
    it('the repeater trap: bound only through `dataSource` is clean; aimed by a flat `object` is refused', () => {
      const bound = validateComponentProps(
        stackWith([{ type: 'element:repeater', dataSource: { object: 'deal_note', limit: 5 }, properties: { titleField: 'subject' } }]),
      );
      expect(bound).toEqual([]);

      const flat = validateComponentProps(
        stackWith([{ type: 'element:repeater', properties: { object: 'deal_note', titleField: 'subject' } }]),
      );
      expect(invalid(flat).map((f) => f.path).sort()).toEqual([
        'pages[0].regions[0].components[0].dataSource.object',
        'pages[0].regions[0].components[0].properties.object',
      ]);
      const tombstone = invalid(flat).find((f) => f.path.endsWith('.properties.object'))!;
      expect(tombstone.message).toMatch(/`element:repeater` property `object` was removed in @objectstack\/spec 18.*`dataSource\.object`/s);
    });

    /**
     * The gate keeps its own copy of the set, because the spec publishes none
     * (an export would widen a retirement that only narrows). This pin derives
     * the set from `ComponentPropsMap` — every row whose flat `object` is a
     * tombstone pointing at `dataSource.object` — so a fourth element retired
     * the same way, or one of the three un-retired, reds here.
     */
    it('the set is the spec rows whose flat `object` is retired onto the binding', () => {
      const derived = Object.entries(ComponentPropsMap)
        .filter(([, schema]) => {
          const parsed = (schema as { safeParse: (v: unknown) => { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } })
            .safeParse({ object: 'probe' });
          return !parsed.success && parsed.error!.issues.some((i) =>
            i.path.length === 1 && i.path[0] === 'object'
            && i.message.includes('was removed') && i.message.includes('`dataSource.object`'));
        })
        .map(([type]) => type)
        .sort();
      expect(derived).toEqual([...BOUND].sort());
      expect([...DATA_SOURCE_BOUND_ELEMENT_TYPES].sort()).toEqual(derived);
    });
  });

  /**
   * #5775 — the retirement's author-facing channel. `displayField` was the
   * picker's REQUIRED prop and no renderer ever read it, so the tombstone's
   * prescription has to reach whoever is still writing it. It arrives through
   * the `safeParse` half of this rule (a `never` type is a value verdict, not
   * an unknown key), carrying the rename verbatim.
   */
  it('surfaces the retired `displayField` prescription (#5775)', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'element:record_picker',
          dataSource: { object: 'project' },
          properties: { displayField: 'name' },
        },
      ]),
    );
    const retired = invalid(findings).filter((f) => f.path.endsWith('.displayField'));
    expect(retired).toHaveLength(1);
    expect(retired[0].severity).toBe('error');
    expect(retired[0].message).toMatch(/removed in @objectstack\/spec 17\.0\.0[\s\S]*`labelField`/);
  });

  /**
   * The showcase page that made #5775 necessary: it authors the shape the
   * renderer serves, and the gate used to report it twice over — an undeclared
   * `labelField`/`label` and a missing required `displayField`. It is clean now.
   */
  it('reports nothing on the showcase picker (page-variables.page.ts:59)', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'element:record_picker',
          id: 'project_picker',
          dataSource: { object: 'showcase_project', limit: 50 },
          properties: { label: 'Project', labelField: 'name', placeholder: 'Choose a project…' },
        },
      ]),
    );
    expect(findings).toEqual([]);
  });

  /**
   * #6276 declared the picker's flat `sort` / `limit` beside `object` /
   * `filter`, because the renderer read all four through one
   * `ds.<k> ?? props.<k>` pattern. #11509 (v18) retired the four: the
   * renderer reads the binding alone since objectui#11880. Each flat key is
   * now a tombstone whose prescription reaches the author through this rule's
   * value verdict — whatever value was written, a valid one included — and
   * the missing binding is its own finding beside them.
   */
  it('refuses the picker\'s four retired flat binding keys with their prescriptions (#11509)', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'element:record_picker',
          id: 'project_picker',
          properties: {
            object: 'showcase_project',
            labelField: 'name',
            filter: [{ field: 'status', operator: 'equals', value: 'active' }],
            sort: [{ field: 'created_at', order: 'desc' }],
            limit: 20,
          },
        },
      ]),
    );
    const base = 'pages[0].regions[0].components[0]';
    expect(invalid(findings).map((f) => f.path).sort()).toEqual([
      `${base}.dataSource.object`,
      `${base}.properties.filter`,
      `${base}.properties.limit`,
      `${base}.properties.object`,
      `${base}.properties.sort`,
    ]);
    for (const key of ['object', 'filter', 'sort', 'limit']) {
      const at = invalid(findings).find((f) => f.path === `${base}.properties.${key}`)!;
      expect(at.message).toMatch(
        new RegExp(`\`element:record_picker\` property \`${key}\` was removed in @objectstack/spec 18.*\`dataSource\\.${key}\``, 's'),
      );
    }
    expect(unknownKeys(findings)).toEqual([]);
  });

  /**
   * The container half of #5775. `page:card` `children` and the three thin
   * containers' `children` were all reported as unknown keys while the
   * renderers rendered exactly them; `record:path` `stages[].terminal` and the
   * tab items' `value`/`count` are the same shape one level down.
   */
  it('reports nothing on the container/child keys the renderers honour (#5775)', () => {
    // The child is filler: the subject is the CONTAINER keys. Since #22212 a
    // nested node is judged even with no `properties` bag, so the filler carries
    // the one prop `element:text` requires instead of omitting it.
    const TEXT_CHILD = { type: 'element:text', properties: { content: 'Hi' } };
    const findings = validateComponentProps(
      stackWith([
        { type: 'page:card', properties: { title: 'Shortcuts', children: [TEXT_CHILD] } },
        { type: 'page:section', properties: { children: [TEXT_CHILD] } },
        { type: 'page:footer', properties: { children: [TEXT_CHILD] } },
        { type: 'page:sidebar', properties: { children: [TEXT_CHILD] } },
        {
          type: 'page:tabs',
          properties: { items: [{ label: 'Tasks', value: 'related:task', count: 3, children: [] }] },
        },
        {
          type: 'record:path',
          properties: {
            statusField: 'status',
            stages: [{ value: 'done', label: 'Done', terminal: 'won' }],
          },
        },
      ]),
    );
    expect(findings).toEqual([]);
  });

  /**
   * #6776 — the five keys #5775's count missed. Each is read by an objectui
   * renderer and each was reported here as an undeclared key, so objectui's
   * published manifest and this gate disagreed about the same author's page.
   * This is the acceptance test for the declaration half: the shapes that used
   * to warn must now be silent.
   */
  it('reports nothing on the page:header / page:accordion keys the renderers honour (#6776)', () => {
    const findings = validateComponentProps(
      stackWith([
        // objectui `apps/console/src/preview-samples.ts:68` verbatim — the
        // measured warning site, on a non-record page.
        { type: 'page:header', properties: { title: 'Welcome to the CRM', recordChrome: false } },
        // `showStar` left this shape at 18 (#23650, a tombstone now refused
        // below); its live sibling stays.
        { type: 'page:header', properties: { title: 'Lead', showCopyId: false } },
        { type: 'page:accordion', properties: { items: [], variant: 'card' } },
        { type: 'page:tabs', properties: { tabStyle: 'card', items: [] } },
      ]),
    );
    expect(findings).toEqual([]);
  });

  /**
   * The other direction of the same card. `page:tabs.type` is now a tombstone,
   * and a tombstone is REFUSED rather than reported as unknown — so the finding
   * arrives as `component-props-invalid` carrying the rename prescription, not
   * as `component-props-unknown-key` carrying nothing. The conversion that
   * rewrites it is `retiredFromLoadPath`, so it deliberately does NOT run on
   * this normalized input: an already-stored page keeps the old key and the
   * author is told, which is the whole point of the tombstone.
   */
  it('refuses the retired `page:tabs.type` by name, with the prescription (#6776)', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'page:tabs', properties: { type: 'card', items: [] } }]),
    );
    expect(invalid(findings).map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.type',
    ]);
    expect(invalid(findings)[0].message).toContain('tabStyle');
    // Not an unknown key — the schema still declares it, as a tombstone.
    expect(unknownKeys(findings)).toEqual([]);
  });

  /**
   * The routing that keeps this gate whole across a future `strictObject`
   * batch. `AriaPropsSchema` is the one CLOSED shape inside these props (#4001
   * 批 16), so an unknown key under `aria` is refused by the PARSE rather than
   * by the unknown-key walker — which stays silent on a strict node by design,
   * so as not to be a second voice over a loud rejection. Both paths land on
   * one rule id: when the ratchet closes `ComponentPropsMap`'s own 31 sites,
   * coverage moves between the halves without moving out of the author's view.
   */
  it('routes a STRICT node\'s rejection to the unknown-key id (aria, closed at #4001 批 16)', () => {
    const findings = validateComponentProps(
      stackWith([
        { type: 'page:header', properties: { title: 'T', aria: { ariaLabel: 'x', ariaLabl: 'typo' } } },
      ]),
    );
    expect(invalid(findings)).toEqual([]);
    expect(unknownKeys(findings)).toHaveLength(1);
    expect(unknownKeys(findings)[0].path).toContain('.aria.ariaLabl');
  });
});

/**
 * `type` is `z.union([PageComponentType, z.string()])` — open by design. The
 * example corpus authors 87 nodes across ten types `ComponentPropsMap` does not
 * carry (`flex`, `grid`, `object-metric`, `object-chart`, `record:line_items`,
 * …): SDUI blocks whose contract lives in objectui's registry and the ADR-0080
 * manifest, not here. Judging them against an absent schema would report every
 * one of them as broken, which is why the skip is a REQUIRED semantic and not
 * leniency (the maintainer's ruling on #5068).
 */
describe('validateComponentProps — unregistered types are skipped', () => {
  // `object-metric` left this list at #7751 — the `object-*` family is
  // registered now. `object-chart` replaces it: deliberately still absent from
  // the map (two-vocabulary problem — see component.zod.ts's object-block
  // section header), so it is the family's own living proof the skip survives.
  // `record:quick_actions` left it at #8744 for the same reason — it has a row
  // now, and its dispatch is pinned in the #8744 suite at the end of this
  // file. `record:line_items` left it at #21142, the last registered `record:*`
  // renderer to get a row; its dispatch is pinned in the #21142 suite below.
  // `flex` stays as the corpus's own row-less specimen.
  it.each(['flex', 'object-chart'])(
    'says nothing about `%s`, whatever its props carry',
    (type) => {
      const findings = validateComponentProps(
        stackWith([{ type, properties: { anything: 1, at: 'all', nested: { deep: true } } }]),
      );
      expect(findings).toEqual([]);
    },
  );
});

/**
 * ── #7751: the gate's dispatch now FINDS the `object-*` family ──────────────
 *
 * No semantic change to this rule — `PROPS_SCHEMAS` is `ComponentPropsMap`, so
 * the new entries are reachable by construction. What must be pinned from THIS
 * side is behaviour through the real door:
 *
 *  1. anti-vacuity — the finding FIRES on the #7750 specimen shape (an
 *     `object-grid` authored with plural `filters`), with the rename named;
 *  2. the clean-corpus control — the showcase pages' actual authored nodes
 *     (copied, not imported) stay finding-free, so registering the family did
 *     not turn working pages red.
 */
describe('validateComponentProps — object-* blocks are dispatched (#7751)', () => {
  it('FIRES on the #7750 specimen: object-grid authored with plural `filters`', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'object-grid',
        properties: {
          objectName: 'showcase_task',
          columns: ['title', 'project', 'status', 'priority', 'due_date'],
          filters: [['owner_id', '=', '{current_user_id}']],
        },
      }]),
    );
    expect(unknownKeys(findings)).toHaveLength(1);
    const [f] = unknownKeys(findings);
    expect(f.severity).toBe('error');
    expect(f.path).toBe('pages[0].regions[0].components[0].properties.filters');
    expect(f.where).toBe('page "probe_page" · object-grid');
    expect(f.message).toContain('`filters`');
    expect(f.message).toContain('Did you mean `filters` → `filter`?');
    // An undeclared key only — no value verdict rides beside it.
    expect(invalid(findings)).toEqual([]);
  });

  it('stays SILENT on the corrected #7750 node and the corpus metric shapes (clean-corpus control)', () => {
    const findings = validateComponentProps(
      stackWith([
        {
          type: 'object-grid',
          properties: {
            objectName: 'showcase_task',
            columns: ['title', 'project', 'status', 'priority', 'due_date'],
            // The rule-array form the four `object-*` doors declare since
            // #15449 (ui#6206-B, one filter orthography); the AST tuple this
            // pin used to carry is refused at `filter.0` now, so the corpus
            // shape it mirrors (`my-work.page.ts`) moved with it.
            filter: [{ field: 'owner_id', operator: 'equals', value: '{current_user_id}' }],
          },
        },
        {
          type: 'object-metric',
          properties: { objectName: 'showcase_task', label: 'Open Tasks', icon: 'list-checks', colorVariant: 'blue', description: 'not done', aggregate: { field: 'id', function: 'count' }, filter: [{ field: 'status', operator: 'not_equals', value: 'done' }] },
        },
        {
          type: 'object-metric',
          properties: { objectName: 'showcase_project', label: 'Projects', colorVariant: 'purple', variant: 'bare', aggregate: { field: 'id', function: 'count' }, format: '0,0' },
        },
        {
          type: 'object-form',
          properties: {
            objectName: 'showcase_project',
            mode: 'create',
            formType: 'wizard',
            showStepIndicator: true,
            title: 'Create a Project',
            description: 'A three-step wizard.',
            sections: [{ label: 'Basics', description: 'Name it.', fields: ['name'] }],
            submitBehavior: { kind: 'thank-you', title: 'Project created', message: 'Ready.' },
          },
        },
        {
          type: 'object-master-detail-form',
          properties: {
            objectName: 'showcase_project',
            mode: 'create',
            formType: 'simple',
            submitText: 'Create Project + Tasks',
            fields: ['name', 'account'],
            details: [{ title: 'Tasks', childObject: 'showcase_task', addLabel: 'Add task' }],
          },
        },
      ]),
    );
    expect(findings).toEqual([]);
  });

  it("answers the designer's dead `groupField` with the `groupBy` the board reads", () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'object-kanban', properties: { objectName: 'task', groupField: 'status' } }]),
    );
    expect(unknownKeys(findings)).toHaveLength(1);
    expect(unknownKeys(findings)[0].message).toContain('Did you mean `groupField` → `groupBy`?');
  });
});

/**
 * The normalized tier, after `page-header-subtitle-alias` retired from the
 * load path at 18 (#23421).
 *
 * The registry entry reads the NORMALIZED tier, and while that conversion was
 * live it rewrote `properties.description` → `subtitle` on header nodes inside
 * `normalizeStackInput`, so `os validate` passed a page the metadata save door
 * (which judges the raw page) refused. Retired, the conversion no longer runs
 * in the authoring funnel: both tiers now carry the authored `description`,
 * and both refuse it with the rename `PageHeaderProps` declares — the same
 * answer every door gives. The conversion still canonicalizes data at rest.
 */
describe('validateComponentProps — reads the post-conversion (normalized) tier', () => {
  const authored = stackWith([
    { type: 'page:header', properties: { title: 'Lead', description: 'All open leads' } },
  ]);
  const DESCRIPTION_PATH = 'pages[0].regions[0].components[0].properties.description';

  it('refuses a retired conversion\'s old key at the normalized tier, naming the rename', () => {
    const findings = validateComponentProps(normalizeStackInput(authored));
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [COMPONENT_PROPS_UNKNOWN_KEY, 'error', DESCRIPTION_PATH],
    ]);
    expect(findings[0].message).toContain('subtitle');
  });

  it('gives the raw tier the same answer — the two doors no longer disagree on this page', () => {
    const raw = validateComponentProps(authored);
    expect(unknownKeys(raw).map((f) => f.path)).toEqual([DESCRIPTION_PATH]);
    expect(unknownKeys(raw)[0].message).toContain('subtitle');
  });
});

describe('validateComponentProps — wiring', () => {
  it('is registered as a gating rule on all three authoring commands (every finding is an error)', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateComponentProps');
    expect(entry).toBeDefined();
    expect(entry?.tier).toBe('gating');
    expect([...(entry?.commands ?? [])].sort()).toEqual(['build', 'lint', 'validate']);
  });

  it('reaches the shared authoring pipeline — the run that reported nothing before #5068', () => {
    const findings = runAuthoringRules('validate', {
      normalized: stackWith([{ type: 'page:header', properties: { title: 'T', titel: 'typo' } }]) as never,
    });
    const mine = findings.filter((f) => f.rule.startsWith('component-props'));
    expect(mine).toHaveLength(1);
    expect(mine[0].severity).toBe('error');
    expect(mine[0].rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
  });
});

/**
 * #23026 — the error upgrade the module header planned, for its first class: a
 * value verdict a `retiredKey()` tombstone raises is an `error` carrying the
 * tombstone's prescription. Asserted on rule id, severity and path — the
 * prescription is asserted as CARRIED (read back from the spec's own
 * tombstone), never as prose copied here.
 */
describe('validateComponentProps — a retired key is an error (#23026)', () => {
  /** The prescription the spec's own tombstone raises for `type.key`, read from the schema. */
  const prescription = (type: string, key: string): string => {
    const schema = (ComponentPropsMap as unknown as Record<string, { safeParse: (v: unknown) => { error?: { issues: Array<{ path: PropertyKey[]; message: string }> } } }>)[type];
    const issue = schema.safeParse({ [key]: 'probe' }).error?.issues.find((i) => i.path.length === 1 && i.path[0] === key);
    expect(issue, `${type}.${key} raises no issue of its own`).toBeDefined();
    return issue!.message;
  };

  it('refuses the card\'s specimen — `object-grid` `defaultFilters` — as an error carrying its prescription', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'object-grid',
        properties: {
          objectName: 'task',
          defaultFilters: [{ field: 'status', operator: 'equals', value: 'open' }],
        },
      }]),
    );
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [COMPONENT_PROPS_INVALID, 'error', 'pages[0].regions[0].components[0].properties.defaultFilters'],
    ]);
    expect(findings[0].message).toContain(prescription('object-grid', 'defaultFilters'));
  });

  /**
   * Every top-level tombstone in the map, found from the SCHEMA GRAPH (a key
   * whose schema is `optional` over `never`), not from the issue shape the
   * rule reads — so a tombstone whose verdict stopped classifying reds here,
   * whichever row it sits on.
   */
  it('refuses every top-level tombstoned prop in ComponentPropsMap as an error, at its own key', () => {
    type Node = { _zod: { def: { type: string; innerType?: Node } } };
    const tombstones = Object.entries(ComponentPropsMap).flatMap(([type, schema]) => {
      const shape = (schema as unknown as { shape?: Record<string, Node> }).shape ?? {};
      return Object.entries(shape)
        .filter(([, node]) => node._zod.def.type === 'optional' && node._zod.def.innerType?._zod.def.type === 'never')
        .map(([key]) => [type, key] as const);
    });
    // Anti-vacuity: the walk reaches the card's specimen and a fair number besides.
    expect(tombstones).toContainEqual(['object-grid', 'defaultFilters']);
    expect(tombstones.length).toBeGreaterThan(30);
    const missed = tombstones.filter(([type, key]) => {
      const findings = validateComponentProps(stackWith([{ type, dataSource: { object: 'task' }, properties: { [key]: 'probe' } }]));
      const at = findings.filter((f) => f.path === `pages[0].regions[0].components[0].properties.${key}`);
      return !(at.length === 1 && at[0].rule === COMPONENT_PROPS_INVALID && at[0].severity === 'error');
    });
    expect(missed).toEqual([]);
  });

  it('refuses a retired ELEMENT\'s bag (`user:profile`) as an error — the same tombstone shape, one grain wider', () => {
    const findings = validateComponentProps(stackWith([{ type: 'user:profile', properties: {} }]));
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [COMPONENT_PROPS_INVALID, 'error', 'pages[0].regions[0].components[0].properties'],
    ]);
  });

  it('refuses a tombstone inside a union arm when that arm is the only one judging keys (`publicPicker`)', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'object-form',
        properties: { objectName: 'task', sections: [{ label: 'S', fields: ['name', { field: 'owner', publicPicker: true }] }] },
      }]),
    );
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [COMPONENT_PROPS_INVALID, 'error', 'pages[0].regions[0].components[0].properties.sections.0.fields.1'],
    ]);
  });

  it('reaches the shared pipeline as an error — the run `os validate` / `os build` / `os lint` refuse on', () => {
    const findings = runAuthoringRules('validate', {
      normalized: stackWith([{ type: 'object-grid', properties: { objectName: 'task', defaultFilters: [] } }]) as never,
    });
    const mine = findings.filter((f) => f.rule.startsWith('component-props'));
    expect(mine.map((f) => [f.rule, f.severity])).toEqual([[COMPONENT_PROPS_INVALID, 'error']]);
  });
});

/**
 * #23147 — the rest of the plan: every other finding of the rule is an `error`
 * too, after an inventory of 0 in this repository and in one corpus authored
 * outside it (the module header records both). One pin per class and per
 * code route that files it, so reverting any one severity reds exactly its
 * own pin. Asserted on rule id, severity and path; the text is not pinned.
 */
describe('validateComponentProps — every other class is an error too (#23147)', () => {
  const at = (rest: string) => `pages[0].regions[0].components[0].${rest}`;
  const verdicts = (node: unknown) =>
    validateComponentProps(stackWith([node])).map((f) => [f.rule, f.severity, f.path]);

  describe('class: `component-props-unknown-key`', () => {
    it('an undeclared key on a strict props schema (the parse\'s `unrecognized_keys`)', () => {
      expect(verdicts({ type: 'page:header', properties: { title: 'T', titel: 'typo' } })).toEqual([
        [COMPONENT_PROPS_UNKNOWN_KEY, 'error', at('properties.titel')],
      ]);
    });

    it('an undeclared key on a strip-mode object below the bag (the walker)', () => {
      expect(verdicts({
        type: 'object-grid',
        properties: { objectName: 'task', sort: [{ field: 'name', order: 'asc', directoin: 'x' }] },
      })).toEqual([
        [COMPONENT_PROPS_UNKNOWN_KEY, 'error', at('properties.sort.0.directoin')],
      ]);
    });

    it('an undeclared key on the one union arm that judged keys (`record:highlights` `fields[]`)', () => {
      expect(verdicts({ type: 'record:highlights', properties: { fields: [{ name: 'status', readOnly: true }] } })).toEqual([
        [COMPONENT_PROPS_UNKNOWN_KEY, 'error', at('properties.fields.0.readOnly')],
      ]);
    });
  });

  describe('class: `component-props-invalid` that is not a retired key', () => {
    it('a wrongly-typed prop', () => {
      expect(verdicts({ type: 'record:related_list', properties: { objectName: 'task', relationshipField: 'p', limit: 'five' } }))
        .toEqual([[COMPONENT_PROPS_INVALID, 'error', at('properties.limit')]]);
    });

    it('a missing required prop', () => {
      expect(verdicts({ type: 'record:related_list', properties: { objectName: 'task' } }))
        .toEqual([[COMPONENT_PROPS_INVALID, 'error', at('properties.relationshipField')]]);
    });

    it('a closed-set refusal — a url action\'s `target` scheme', () => {
      expect(verdicts({ type: 'element:button', properties: { label: 'Go', action: { type: 'url', target: 'javascript:alert(1)' } } }))
        .toEqual([[COMPONENT_PROPS_INVALID, 'error', at('properties.action.target')]]);
    });

    it('a closed-set refusal — a `record:details` section `count` whose heading binds no hole', () => {
      const findings = validateComponentProps(
        stackWith([{ type: 'record:details', properties: { sections: [{ label: 'Tags', fields: ['tags'], count: { field: 'tags' } }] } }]),
      );
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => f.rule === COMPONENT_PROPS_INVALID && f.severity === 'error')).toBe(true);
    });

    it('a retired enum VALUE — an enum issue, not a tombstone (`object-grid` `exportOptions.formats` `pdf`)', () => {
      expect(verdicts({ type: 'object-grid', properties: { objectName: 'task', exportOptions: { formats: ['pdf'] } } }))
        .toEqual([[COMPONENT_PROPS_INVALID, 'error', at('properties.exportOptions.formats.0')]]);
    });

    it('a missing `dataSource.object` binding on a data-source-bound element', () => {
      expect(verdicts({ type: 'element:number', properties: { aggregate: 'count' } }))
        .toEqual([[COMPONENT_PROPS_INVALID, 'error', at('dataSource.object')]]);
    });

    it('a union verdict where the tombstone\'s arm also rejects a value for another reason', () => {
      expect(verdicts({
        type: 'object-form',
        properties: { objectName: 'task', sections: [{ label: 'S', fields: [{ field: 'owner', publicPicker: true, colSpan: 'wide' }] }] },
      }).map(([rule, severity]) => [rule, severity])).toEqual([[COMPONENT_PROPS_INVALID, 'error']]);
    });
  });

  it('classifies per issue for the FIX, not the severity: a retired key beside a wrongly-typed prop', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'object-grid', properties: { objectName: 'task', defaultFilters: [], pageSize: 'ten' } }]),
    );
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [COMPONENT_PROPS_INVALID, 'error', at('properties.defaultFilters')],
      [COMPONENT_PROPS_INVALID, 'error', at('properties.pageSize')],
    ]);
    // The retired key's fix is its prescription, the other's a props change:
    // two different hints for one rule id and one type.
    expect(findings[0].hint).not.toBe(findings[1].hint);
  });

  it('reaches the shared pipeline as errors — the run `os validate` / `os build` / `os lint` refuse on', () => {
    const findings = runAuthoringRules('validate', {
      normalized: stackWith([
        { type: 'page:header', properties: { title: 'T', titel: 'typo' } },
        { type: 'element:number', properties: { aggregate: 'count' } },
      ]) as never,
    });
    const mine = findings.filter((f) => f.rule.startsWith('component-props'));
    expect(mine.map((f) => [f.rule, f.severity])).toEqual([
      [COMPONENT_PROPS_UNKNOWN_KEY, 'error'],
      [COMPONENT_PROPS_INVALID, 'error'],
    ]);
  });
});

/**
 * #4001 batch A closed all 31 `ComponentPropsMap` shapes, including two UNION
 * ARMS. An arm's rejection travels a different road out of zod than an object's,
 * and this block pins both that it arrives and that it is not over-claimed.
 */
describe('validateComponentProps — a STRICT union arm reports as an unknown key (#4001 batch A)', () => {
  const highlights = (fields: unknown) =>
    validateComponentProps(stackWith([{ type: 'record:highlights', properties: { fields } }]));

  it('routes an arm-level `unrecognized_keys` to the unknown-key rule, with the surface and the rename intact', () => {
    const findings = highlights([{ name: 'status', labell: 'Status' }]);
    expect(findings).toHaveLength(1);
    // The rule id is the point: a closed arm and a closed object are ONE
    // diagnostic for the author, not two with different hints.
    expect(findings[0].rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
    expect(findings[0].path).toBe('pages[0].regions[0].components[0].properties.fields.0.labell');
    // Zod collapses arm failures into one `invalid_union` whose own message is
    // the bare "Invalid input" — everything below survives only because
    // `zod-issue-format.ts` unpacks the arm. Delete that unpacking and these
    // three assertions go red while `packages/spec`'s own suite stays green,
    // which is exactly the blind spot they exist for.
    expect(findings[0].message).toContain('record:highlights` field');
    expect(findings[0].message).toContain('`labell`');
    expect(findings[0].message).toContain('label');
    expect(findings[0].message).not.toContain('Invalid input —');
  });

  it('does NOT claim a rename when the author may have meant another arm', () => {
    // The bare-string arm is legal here, so a value that fails BOTH arms for
    // key reasons cannot be attributed to one of them. It falls through to the
    // value verdict, which prints every arm's own message rather than guessing.
    const findings = highlights([{ labell: 'Status' }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(COMPONENT_PROPS_INVALID);
    // Still legible — the arms are unpacked, just not attributed.
    expect(findings[0].message).toContain('no accepted form matched');
  });

  it('positive control — the string arm and the full object arm both stay silent', () => {
    expect(highlights(['status'])).toEqual([]);
    expect(highlights([{ name: 'status', label: 'Status', readonly: true }])).toEqual([]);
  });
});

/**
 * #8691 — the rail's row exists, so the gate's dispatch reaches it.
 *
 * The pre-fix state this pins against: `record:reference_rail` had no
 * `ComponentPropsMap` row, so the walker's unregistered-type skip swallowed the
 * whole props bag — the issue's planted `filter` produced ZERO findings from
 * validate/build while `record:related_list` keys in the same file were loudly
 * reported. Remove the map row and every assertion in the first test here goes
 * back to that silence (the reverse verification the issue ran on a real app).
 */
describe('validateComponentProps — record:reference_rail is dispatched (#8691)', () => {
  it('reports the issue\'s planted entry `filter`, loudly, through the same rule as its siblings', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'record:reference_rail',
        properties: {
          entries: [{
            objectName: 'task',
            relationshipField: 'project_id',
            filter: [{ field: 'status', op: 'neq', value: 'completed' }],
          }],
        },
      }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
    expect(findings[0].where).toBe('page "probe_page" · record:reference_rail');
    expect(findings[0].message).toContain('`filter`');
    // The prescription names where `filter` IS real, so the author is routed
    // to the component that delivers it rather than left with a bare refusal.
    expect(findings[0].message).toContain('record:related_list');
  });

  it('stays silent on the shape the renderer actually reads', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'record:reference_rail',
        properties: {
          entries: [
            { objectName: 'task', relationshipField: 'project_id', title: 'Tasks', limit: 3, displayField: 'subject' },
          ],
          hideEmpty: false,
        },
      }]),
    );
    expect(findings).toEqual([]);
  });
});

/**
 * #8744 — the rows for the four types the rail fix left behind, so the gate's
 * dispatch reaches them.
 *
 * The pre-fix state these pin against: `record:alert`, `record:quick_actions`,
 * `record:history` and `record:discussion` had no `ComponentPropsMap` row, so
 * the walker's unregistered-type skip swallowed the whole props bag — the
 * card's planted `severty` produced ZERO findings from validate/build while
 * `record:related_list` keys in the same file were loudly reported. Remove any
 * of the map rows and its first test here goes back to that silence.
 */
describe('validateComponentProps — record:alert / record:quick_actions / record:history / record:discussion are dispatched (#8744)', () => {
  it('reports the card\'s planted `severty`, loudly, through the same rule as its siblings', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'record:alert',
        properties: { severty: 'warning', title: 'Awaiting review' },
      }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
    expect(findings[0].where).toBe('page "probe_page" · record:alert');
    expect(findings[0].message).toContain('`severty`');
    expect(findings[0].message).toContain('severity');
  });

  it('stays silent on the platform sys_user banner shape — inline locale maps and CEL predicate included', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'record:alert',
        properties: {
          severity: 'warning',
          icon: 'mail',
          title: { en: 'Email not verified', 'zh-CN': '邮箱未验证' },
          body: { en: 'Verify your email.' },
          visible: 'record.id == ctx.user.id && record.email_verified == false',
          dismissible: false,
          action: { actionName: 'resend_verification_email', label: { en: 'Resend' } },
        },
      }]),
    );
    expect(findings).toEqual([]);
  });

  it('reports quick_actions\' host-channel `actions` and routes the author to `actionNames`', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'record:quick_actions',
        properties: { actions: ['showcase_mark_done'], location: 'record_section' },
      }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
    expect(findings[0].message).toContain('`actions`');
    expect(findings[0].message).toContain('actionNames');
  });

  it('stays silent on the showcase quick_actions bar', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'record:quick_actions',
        properties: {
          location: 'record_section',
          align: 'start',
          actionNames: ['showcase_mark_done', 'showcase_log_time', 'showcase_archive_task'],
        },
      }]),
    );
    expect(findings).toEqual([]);
  });

  it('reports history\'s host-channel `entries` with the self-fetch prescription, and accepts its three presentation keys', () => {
    const loud = validateComponentProps(
      stackWith([{
        type: 'record:history',
        properties: { entries: [], limit: 20 },
      }]),
    );
    expect(loud).toHaveLength(1);
    expect(loud[0].rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
    expect(loud[0].message).toContain('`entries`');
    expect(loud[0].message).toContain('sys_activity');

    const silent = validateComponentProps(
      stackWith([{
        type: 'record:history',
        properties: { limit: 20, emptyText: 'No changes yet', unknownUserText: 'System' },
      }]),
    );
    expect(silent).toEqual([]);
  });

  it('judges `record:discussion` — the fifth silent surface — with `record:chatter`\'s own row', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'record:discussion',
        properties: { dock: 'right' },
      }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
    expect(findings[0].where).toBe('page "probe_page" · record:discussion');
    expect(findings[0].message).toContain('`dock`');
  });
});

/**
 * #11575 — the two `@objectstack/cloud-connection` console widgets, so the
 * gate's dispatch reaches them.
 *
 * The pre-fix state these pin against: `cloud-connection:panel` and
 * `marketplace:installed-list` had no `ComponentPropsMap` row (they are
 * open-string-arm types — never in `PageComponentType` — so nothing else
 * judged them either), and the walker's unregistered-type skip swallowed the
 * whole props bag: any authored key produced ZERO findings from
 * validate/build. `cloud-connection:panel`'s row is strict and EMPTY —
 * measured from the renderer's read points at the `.objectui-sha` pin, where
 * the registration discards the schema node (`() => <Widget />`) — so EVERY
 * authored key is a finding. Remove the map row and its loud test here goes
 * back to that silence.
 *
 * #24230 — `marketplace:installed-list` is RETIRED by name (its one renderer
 * was deleted with the separate Installed Apps view). Its row is kept as a
 * whole-bag refusal, so the same dispatch now refuses EVERY bag, `{}` included,
 * as `component-props-invalid`; the type rule reports the node too (the
 * map-driven `flags %s` case in `validate-component-types.test.ts`).
 */
describe('validateComponentProps — cloud-connection:panel / marketplace:installed-list are dispatched (#11575)', () => {
  it('reports any key authored on `cloud-connection:panel`, naming the zero-prop surface', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'cloud-connection:panel',
        properties: { pollInterval: 5 },
      }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
    expect(findings[0].where).toBe('page "probe_page" · cloud-connection:panel');
    expect(findings[0].message).toContain('`pollInterval`');
    expect(findings[0].message).toContain('cloud-connection:panel');
  });

  it('refuses the retired `marketplace:installed-list` bag WHOLE, `{}` included, as an error', () => {
    for (const properties of [{}, { filter: 'installed' }]) {
      const findings = validateComponentProps(
        stackWith([{ type: 'marketplace:installed-list', properties }]),
      );
      expect(findings.map((f) => [f.rule, f.severity])).toEqual([[COMPONENT_PROPS_INVALID, 'error']]);
      expect(findings[0].where).toBe('page "probe_page" · marketplace:installed-list');
    }
  });

  it('stays silent on the empty bag the cloud-connection page authors', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'cloud-connection:panel', properties: {} }]),
    );
    expect(findings).toEqual([]);
  });
});

/**
 * #12344 — the `@objectstack/mcp` console widget, the same mechanism a third
 * instance over.
 *
 * The pre-fix state this pins against: `mcp:connect-agent` had no
 * `ComponentPropsMap` row (an open-string-arm type — never in
 * `PageComponentType` — so nothing else judged it either), and the walker's
 * unregistered-type skip swallowed the whole props bag: any authored key
 * produced ZERO findings from validate/build, and door 3 of the mcp
 * canonical-envelope gate (#12269) had to carry a standing exemption for the
 * type. Its row is strict and EMPTY — measured from the renderer's read
 * points at the `.objectui-sha` pin, where the registration discards the
 * schema node (`() => <ConnectAgent />`) and the component function takes no
 * parameters — so EVERY authored key is a finding. Remove the map row and
 * this loud test goes back to that silence.
 */
describe('validateComponentProps — mcp:connect-agent is dispatched (#12344)', () => {
  it('reports any key authored on `mcp:connect-agent`, naming the zero-prop surface', () => {
    const findings = validateComponentProps(
      stackWith([{
        type: 'mcp:connect-agent',
        properties: { serverUrl: 'https://example.test/mcp' },
      }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
    expect(findings[0].where).toBe('page "probe_page" · mcp:connect-agent');
    expect(findings[0].message).toContain('`serverUrl`');
    expect(findings[0].message).toContain('mcp:connect-agent');
  });

  it('stays silent on the empty bag the plugin-shipped page authors', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'mcp:connect-agent', properties: {} }]),
    );
    expect(findings).toEqual([]);
  });
});

/**
 * #21142 — `record:line_items` gets its row, so the gate's dispatch reaches it.
 *
 * The pre-fix state this pins against: the type had no `ComponentPropsMap`
 * row (it was the string-arm registration ledger's one entry), so the
 * walker's unregistered-type skip swallowed the whole props bag — the
 * showcase project page's five `field`-keyed columns produced ZERO findings
 * while the grid drew every cell empty. Remove the map row and the first test
 * here goes back to that silence.
 */
describe('validateComponentProps — record:line_items is dispatched (#21142)', () => {
  /** The showcase project page's block as it was authored before the fix (copied, not imported). */
  const fieldKeyed = {
    type: 'record:line_items',
    properties: {
      childObject: 'showcase_task',
      relationshipField: 'project',
      amountField: 'estimate_hours',
      title: 'Tasks',
      columns: [
        { field: 'title', label: 'Title', type: 'text', required: true },
        { field: 'estimate_hours', label: 'Estimate (h)', type: 'number' },
      ],
    },
  };

  it('reports a `field`-keyed column at its own path, with the rename to `name`', () => {
    const findings = validateComponentProps(stackWith([fieldKeyed]));
    const unknown = unknownKeys(findings);
    expect(unknown.map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.columns.0.field',
      'pages[0].regions[0].components[0].properties.columns.1.field',
    ]);
    for (const f of unknown) {
      expect(f.where).toBe('page "probe_page" · record:line_items');
      expect(f.message).toContain('`name`');
    }
    // The column's identity is missing too: the value half names it.
    expect(invalid(findings).map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.columns.0.name',
      'pages[0].regions[0].components[0].properties.columns.1.name',
    ]);
  });

  it('stays silent on the same block keyed by `name` — the fixed showcase shape', () => {
    const columns = fieldKeyed.properties.columns.map(({ field, ...rest }) => ({ name: field, ...rest }));
    const findings = validateComponentProps(
      stackWith([{ ...fieldKeyed, properties: { ...fieldKeyed.properties, columns } }]),
    );
    expect(findings).toEqual([]);
  });
});

// [#22161] Slice 21: the `fix:` line of a value the props schema rejects is one
// remedy line. Where the props schema lives, that the page — not the schema — is
// what to fix in almost every case, and the retired-key and node-binding cases
// are the id's `os explain` entry. The retired-key and binding lines were one
// remedy each already, and are unchanged.
describe('[#22161] one-line fix — component-props-invalid', () => {
  const GENERAL = (type: string) =>
    `Give \`${type}\` a value its props schema accepts (the verdict names what it expects), or correct the ` +
    'schema if the component really honours what is written.';

  it('a wrong-typed prop prints the one remedy line', () => {
    const findings = validateComponentProps(
      stackWith([{ type: 'object-grid', properties: { objectName: 'task', pageSize: 'ten' } }]),
    );
    expect(findings.map((f) => [f.rule, f.hint])).toEqual([[COMPONENT_PROPS_INVALID, GENERAL('object-grid')]]);
  });

  it('every `fix:` line the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === COMPONENT_PROPS_INVALID);
    // Coverage control: the general line, the retired-key line and the
    // node-binding line all fired.
    expect(converted.some((f) => f.hint.startsWith('Give `'))).toBe(true);
    expect(converted.some((f) => f.hint.startsWith('Apply the prescription above'))).toBe(true);
    expect(converted.some((f) => f.hint.startsWith('Name the object on the component node'))).toBe(true);
    for (const f of converted) {
      expect(f.hint).not.toContain('\n');
      expect(f.hint.length, f.hint).toBeLessThanOrEqual(200);
    }
  });

  it('each line that names its type still fits for the longest type `ComponentPropsMap` declares', () => {
    // The two lines that interpolate the type, measured from a fired sample
    // and re-measured at the longest key: a type the map grows past the bound
    // turns this red rather than printing a second line.
    const longest = Math.max(...Object.keys(ComponentPropsMap).map((t) => t.length));
    for (const lead of ['Give `', 'Apply the prescription above']) {
      const sample = fired.find((f) => f.rule === COMPONENT_PROPS_INVALID && f.hint.startsWith(lead))!;
      const type = sample.where.slice(sample.where.indexOf('· ') + 2);
      expect(sample.hint, lead).toContain(`\`${type}\``);
      expect(sample.hint.length - type.length + longest, lead).toBeLessThanOrEqual(200);
    }
  });

  it('`os explain component-props-invalid` carries what the `fix:` line no longer says', () => {
    const text = explainRule(COMPONENT_PROPS_INVALID)!.paragraphs.join('\n');
    for (const fact of ['`ComponentPropsMap`', '`@objectstack/spec/ui`', 'declaration and the renderer agree', 'never a schema change']) {
      expect(text, fact).toContain(fact);
    }
  });
});
