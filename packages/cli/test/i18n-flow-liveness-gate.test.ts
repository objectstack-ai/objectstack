// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#11624 — two rules in one `os lint` run pointed opposite ways.
//
// ## The defect these pins aim at
//
// `os lint` computes i18n coverage AND runs the authoring-rule registry (which
// includes `lintLivenessProperties`) in a single pass over the same stack. The
// `flow` coverage bucket, new in #11615, harvested `flows.<f>.label`,
// `flows.<f>.screens.<n>.title` and the per-field `label`/`placeholder`. While
// the `flows` row of `@objectstack/spec/liveness/translation.json` was
// `status: planned` + `authorWarn: true` (the console's screen-flow runner read
// `screens` but not yet the flow's own `label`), the two rules collided.
//
// Measured on one stack before the fix:
//
//   author OMITS the keys → 4 × `i18n/missing-flow`, 0 liveness findings
//   author ADDS   the keys → 0 × `i18n/missing-flow`, 2 × `liveness-planned-property`
//                            ("sets `flows` but this translation property is planned")
//
// and no third move: `os lint` has no per-rule suppression, only `--skip-i18n`,
// which silences the whole `i18n/missing-*` family — the very signal #11485
// restored. Under `--i18n-strict` the demand side is an ERROR, so a project
// could be forced to author keys it is then warned for.
//
// The fix gated the DEMAND on the ledger and left the warn alone: a group the
// ledger warns on is left out of the coverage walk and the extract skeleton.
//
// ## What is pinned, now that the row is `live`
//
// The runner names the flow by `flows.<f>.label` too, so the row is `live`,
// carries no `authorWarn`, and no translation group is warned. The gate is
// group-general and read from the ledger rather than switched on `flows` by
// name, so it let the group back in on that day with no edit to the walker,
// and any FUTURE group that acquires a warn is gated on the day it is marked.
// Pinned below against the REAL shipped ledger — deliberately, so this file goes
// red the day the ledger moves again and someone has to look at both halves:
//
//   - the census: no translation group is warned, as an equality;
//   - the walk with the ledger's own set is the ungated walk, `flows.*` included,
//     and `os lint` reports the untranslated wizard;
//   - the collision cannot recur: omitting the keys draws demand and no warning,
//     and authoring them draws neither;
//   - the extract skeleton carries the group.
//
// The GATED behaviour itself, which no shipped row exercises any more, is held
// by the injected-set pin at the bottom ("gates whatever the ledger names"),
// the planted fixture the census cannot be. The bucket's own key face lives in
// `i18n-flow-screen-coverage.test.ts`.

import { describe, it, expect } from 'vitest';
import {
  authorWarnedTranslationGroups,
  collectExpectedEntries,
  extractTranslations,
} from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { authorWarnedProperties, lintLivenessProperties } from '@objectstack/lint';

const leadConversion = {
  name: 'lead_conversion',
  label: 'Convert Lead',
  type: 'screen',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'conversion_details',
      type: 'screen',
      label: 'Conversion Details Step',
      config: {
        title: 'Conversion Details',
        fields: [
          { name: 'create_opportunity', label: 'Create Opportunity?', type: 'boolean' },
          { name: 'opportunity_name', label: 'Opportunity Name', placeholder: 'Acme - Q3 renewal' },
        ],
      },
    },
  ],
  edges: [],
};

/** The wizard's own translated copy, in the shape an author would write. */
const flowTranslations = {
  lead_conversion: {
    label: '线索转化',
    screens: {
      conversion_details: {
        title: '转化详情',
        fields: {
          create_opportunity: { label: '创建商机？' },
          opportunity_name: { label: '商机名称', placeholder: 'Acme - 第三季度续约' },
        },
      },
    },
  },
};

/**
 * An app that translates: one object (fully translated, so it contributes no
 * noise) and one screen flow. `withFlowCopy` is the author's only other move.
 */
const app = (withFlowCopy: boolean) => ({
  i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
  objects: [{ name: 'crm_lead', label: 'Lead', fields: { company: { label: 'Company' } } }],
  flows: [leadConversion],
  translations: [
    {
      'zh-CN': {
        objects: { crm_lead: { label: '线索', fields: { company: { label: '公司' } } } },
        ...(withFlowCopy ? { flows: flowTranslations } : {}),
      },
    },
  ],
});

const flowDemands = (config: any) =>
  computeI18nCoverage(config).issues.filter((i) => i.source === 'flow');
const flowWarnings = (config: any) =>
  lintLivenessProperties(config).filter((f) => f.message.includes('`flows`'));

/** An injected empty set: the walk as the gate runs it when the ledger warns on no group. */
const UNGATED = { warnedGroups: new Set<string>() };

describe('the liveness gate on the i18n coverage walk', () => {
  it('names no translation group as warned — `flows` is live', () => {
    // The census, after the flip. An equality, not a `not.toContain`, so the
    // day any translation group acquires a warn this goes red and the collision
    // is considered before it ships rather than after.
    expect([...authorWarnedTranslationGroups()]).toEqual([]);
  });

  it('can say no and yes: the reader under the census still answers for a type with a warned row', () => {
    // A zero-hit result only counts once the same instrument returns a positive
    // on a term known present. The census above is now the zero, so the positive
    // comes from the ledger reader it wraps, on the one planned + authorWarn row
    // still in tree; the negatives are the groups the walker emits.
    expect(authorWarnedProperties('object').has('externalSharingModel')).toBe(true);
    const warned = authorWarnedTranslationGroups();
    for (const live of ['objects', 'apps', 'pages', 'dashboards', 'globalActions', 'metadataForms', 'flows']) {
      expect(warned.has(live)).toBe(false);
    }
  });

  it("walks `flows.*` with the ledger's own set — the same walk as an ungated one", () => {
    const keys = (opts?: { warnedGroups: ReadonlySet<string> }) =>
      collectExpectedEntries(app(false), opts).map((e) => e.path.join('.')).sort();
    expect(keys()).toEqual(keys(UNGATED));

    const roots = new Set(collectExpectedEntries(app(false)).map((e) => e.path[0]));
    expect(roots.has('flows')).toBe(true);
    // Not a flows-only walk: the same call still harvests the other groups.
    expect(roots.has('objects')).toBe(true);
    expect(roots.has('metadataForms')).toBe(true);
  });

  it('reports the untranslated wizard as `i18n/missing-flow`, on a tree that still reports its object gaps', () => {
    const untranslatedObject = {
      ...app(false),
      translations: [{ 'zh-CN': { objects: { crm_lead: { label: '线索' } } } }],
    };

    expect(flowDemands(app(false)).map((i) => `${i.locale} ${i.key}`).sort()).toEqual([
      'zh-CN flows.lead_conversion.label',
      'zh-CN flows.lead_conversion.screens.conversion_details.fields.create_opportunity.label',
      'zh-CN flows.lead_conversion.screens.conversion_details.fields.opportunity_name.label',
      'zh-CN flows.lead_conversion.screens.conversion_details.fields.opportunity_name.placeholder',
      'zh-CN flows.lead_conversion.screens.conversion_details.title',
    ]);
    // The translated wizard draws none, so the demand is the wizard's own gap.
    expect(flowDemands(app(true))).toEqual([]);
    // The report is live — the same run still speaks about the other groups.
    expect(
      computeI18nCoverage(untranslatedObject).issues.some(
        (i) => i.source === 'field' && i.locale === 'zh-CN',
      ),
    ).toBe(true);
  });

  it('never lets both rules speak about the same keys — the collision itself', () => {
    // Omitting the keys draws the demand and no warning; authoring them draws
    // neither. A branch producing BOTH is the collision this file exists for,
    // and the second branch is the move the author lacked while the row warned.
    expect(flowDemands(app(false)).length).toBeGreaterThan(0);
    expect(flowWarnings(app(false))).toEqual([]);

    expect(flowDemands(app(true))).toEqual([]);
    expect(flowWarnings(app(true))).toEqual([]);

    // Not a lint that stopped loading ledgers: the same rule over the same
    // translated app, plus the one warned object row in tree, raises that row.
    const witnessed = lintLivenessProperties({
      ...app(true),
      objects: [...app(true).objects, { name: 'crm_widget', externalSharingModel: 'read' }],
    });
    expect(witnessed.some((f) => f.message.includes('externalSharingModel'))).toBe(true);
    expect(witnessed.some((f) => f.message.includes('`flows`'))).toBe(false);
  });

  it('scaffolds the `flows` group into the extract skeleton — no key of it is warned', () => {
    const { bundles } = extractTranslations(app(false), { locales: ['en', 'zh-CN'] });

    expect((bundles.en as any).flows?.lead_conversion?.label).toBe('Convert Lead');
    expect((bundles.en as any).flows?.lead_conversion?.screens?.conversion_details?.title).toBe('Conversion Details');
    // `os i18n extract` is the other door through the same gate, so it reads
    // the same set; the other groups are scaffolded as before.
    expect((bundles.en as any).objects.crm_lead.label).toBe('Lead');
  });

  it('turns itself back on when the row goes `live` — no new switch', () => {
    const keys = collectExpectedEntries(app(false), UNGATED)
      .filter((e) => e.path[0] === 'flows')
      .map((e) => e.path.join('.'))
      .sort();

    expect(keys).toEqual([
      'flows.lead_conversion.label',
      'flows.lead_conversion.screens.conversion_details.fields.create_opportunity.inlineHelpText',
      'flows.lead_conversion.screens.conversion_details.fields.create_opportunity.label',
      'flows.lead_conversion.screens.conversion_details.fields.create_opportunity.placeholder',
      'flows.lead_conversion.screens.conversion_details.fields.opportunity_name.inlineHelpText',
      'flows.lead_conversion.screens.conversion_details.fields.opportunity_name.label',
      'flows.lead_conversion.screens.conversion_details.fields.opportunity_name.placeholder',
      'flows.lead_conversion.screens.conversion_details.title',
    ]);
  });

  it('gates whatever the ledger names, not `flows` by name', () => {
    // The generality that answers the finding's ⚠️: a second warned group is
    // handled by the same read, on the day it is marked. Driven here through
    // the injected set because the ledger has no such row today.
    const roots = (opts: { warnedGroups: ReadonlySet<string> }) =>
      new Set(collectExpectedEntries(app(false), opts).map((e) => e.path[0]));

    expect(roots({ warnedGroups: new Set(['objects']) }).has('objects')).toBe(false);
    expect(roots({ warnedGroups: new Set(['objects']) }).has('metadataForms')).toBe(true);
    expect(roots(UNGATED).has('objects')).toBe(true);
  });
});
