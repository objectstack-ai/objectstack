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
import {
  validateComponentProps,
  COMPONENT_PROPS_UNKNOWN_KEY,
  COMPONENT_PROPS_INVALID,
} from './validate-component-props.js';
import { runAuthoringRules, AUTHORING_RULES } from './authoring-rules.js';

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
    expect(f.severity).toBe('warning');
    expect(f.path).toBe('pages[0].regions[0].components[0].properties.titel');
    expect(f.where).toBe('page "probe_page" · page:header');
    expect(f.message).toContain('Did you mean `title`?');
  });

  it('is silent on a fully declared props bag', () => {
    const findings = validateComponentProps(
      stackWith([
        { type: 'page:header', properties: { title: 'T', subtitle: 'S', breadcrumb: true } },
        {
          type: 'record:related_list',
          properties: { objectName: 'task', relationshipField: 'project_id', limit: 5 },
        },
      ]),
    );
    expect(findings).toEqual([]);
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
    expect(unknownKeys(findings)[0].message).toContain('Did you mean `readonly`?');
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
    expect(invalid(findings)[0].severity).toBe('warning');
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
   * `ElementDataSourceSchema` is the component-node binding that "overrides
   * page-level object context", and objectui's element renderers read it FIRST
   * (`ds.object ?? props.object`). A component that binds through it has not
   * omitted the flat shorthand — so reporting the props schema's required
   * `object` here would be a WRONG verdict, not a strict one.
   */
  it('does not report the required `object` prop when `dataSource` supplies it', () => {
    const withDataSource = validateComponentProps(
      stackWith([
        {
          type: 'element:record_picker',
          id: 'picker',
          dataSource: { object: 'project', limit: 50 },
          properties: { displayField: 'name' },
        },
      ]),
    );
    expect(withDataSource).toEqual([]);

    // …and still reports it when nothing supplies it (or the suppression above
    // would be indistinguishable from the rule never looking).
    const without = validateComponentProps(
      stackWith([{ type: 'element:record_picker', properties: { displayField: 'name' } }]),
    );
    expect(invalid(without).map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.object',
    ]);
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
  it.each(['record:line_items', 'flex', 'object-metric', 'record:quick_actions'])(
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
 * Why the registry entry reads the NORMALIZED tier.
 *
 * The props bag survives the Zod parse unchanged (`z.record(z.string(),
 * z.unknown())`), so the two tiers carry identical props and the choice looks
 * free. It is not: the ADR-0087 D2 conversion layer runs INSIDE
 * `normalizeStackInput`, and `page-header-subtitle-alias` rewrites
 * `properties.description` → `subtitle` on header nodes. Reading the raw
 * authored input would report a key the conversion layer has already fixed —
 * the rule contradicting a declared conversion, which is exactly the
 * second-de-facto-contract shape Prime Directive #12 forbids.
 */
describe('validateComponentProps — reads the post-conversion (normalized) tier', () => {
  const authored = stackWith([
    { type: 'page:header', properties: { title: 'Lead', description: 'All open leads' } },
  ]);

  it('says nothing about a key the ADR-0087 conversion layer canonicalizes', () => {
    expect(validateComponentProps(normalizeStackInput(authored))).toEqual([]);
  });

  it('WOULD report it pre-conversion — which is why the tier is not free', () => {
    const raw = validateComponentProps(authored);
    expect(unknownKeys(raw).map((f) => f.path)).toEqual([
      'pages[0].regions[0].components[0].properties.description',
    ]);
  });
});

describe('validateComponentProps — wiring', () => {
  it('is registered as an advisory rule on all three authoring commands', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateComponentProps');
    expect(entry).toBeDefined();
    expect(entry?.tier).toBe('advisory');
    expect([...(entry?.commands ?? [])].sort()).toEqual(['build', 'lint', 'validate']);
  });

  it('reaches the shared authoring pipeline — the run that reported nothing before #5068', () => {
    const findings = runAuthoringRules('validate', {
      normalized: stackWith([{ type: 'page:header', properties: { title: 'T', titel: 'typo' } }]) as never,
    });
    const mine = findings.filter((f) => f.rule.startsWith('component-props'));
    expect(mine).toHaveLength(1);
    expect(mine[0].severity).toBe('warning');
    expect(mine[0].rule).toBe(COMPONENT_PROPS_UNKNOWN_KEY);
  });
});
