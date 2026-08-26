// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#11624 — two rules in one `os lint` run pointed opposite ways.
//
// ## The defect these pins aim at
//
// `os lint` computes i18n coverage AND runs the authoring-rule registry (which
// includes `lintLivenessProperties`) in a single pass over the same stack. The
// `flow` coverage bucket, new in #11615, harvested `flows.<f>.label`,
// `flows.<f>.screens.<n>.title` and the per-field `label`/`placeholder`. The
// `flows` row of `@objectstack/spec/liveness/translation.json` is
// `status: planned` + `authorWarn: true` — no shipped runner reads the group.
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
// ⛔ The warn side is NOT the bug and is not softened here. Nothing reads the
// group, so a translated wizard string really is stored and never shown —
// the failure mode `validationMessages` was removed in 17.0.0 for. The demand
// is the premature half, and it is what is gated.
//
// ## What is pinned
//
// The gate is group-general and read from the ledger rather than switched on
// `flows` by name, so (a) it self-activates when the row flips to `live` with
// the objectui runner, and (b) any FUTURE group that acquires a warn is covered
// on the day it is marked rather than re-opening this collision one group at a
// time. Both properties are pinned below, and so is the census the finding
// asked for: `flows` is the only warned translation group today.
//
// The post-flip behaviour of the bucket itself lives in
// `i18n-flow-screen-coverage.test.ts`, which simulates a `live` row. This file
// runs against the REAL shipped ledger — deliberately, so it goes red the day
// the row moves and someone has to look at both halves together.

import { describe, it, expect } from 'vitest';
import {
  authorWarnedTranslationGroups,
  collectExpectedEntries,
  extractTranslations,
} from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { lintLivenessProperties } from '@objectstack/lint';

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

/** The ledger row is `planned`, so the whole surface is walked but not emitted. */
const UNGATED = { warnedGroups: new Set<string>() };

describe('the liveness gate on the i18n coverage walk', () => {
  it('names `flows` — and nothing else — as a warned translation group', () => {
    // The census #11624 asked for: is any OTHER `planned` + `authorWarn` group
    // in the coverage walker's reach? Today, no. This is an equality, not a
    // `toContain`, so the day a second group acquires a warn this goes red and
    // the collision is considered before it ships rather than after.
    expect([...authorWarnedTranslationGroups()]).toEqual(['flows']);
  });

  it('can say no: the live groups the walker also harvests are absent from that set', () => {
    // A zero-hit result only counts once the same instrument returns a positive
    // on a term known present, so the assertion above supplies the positive and
    // this one the negatives — every other top-level group the walker emits.
    const warned = authorWarnedTranslationGroups();
    for (const live of ['objects', 'apps', 'pages', 'dashboards', 'globalActions', 'metadataForms']) {
      expect(warned.has(live)).toBe(false);
    }
  });

  it('emits no `flows.*` key while the row is `planned` — and still walks everything else', () => {
    const roots = new Set(collectExpectedEntries(app(false)).map((e) => e.path[0]));

    expect(roots.has('flows')).toBe(false);
    // Not an empty-walk artifact: the same call still harvests the live groups.
    expect(roots.has('objects')).toBe(true);
    expect(roots.has('metadataForms')).toBe(true);
  });

  it('reports no `i18n/missing-flow`, on a tree that still reports its object gaps', () => {
    const untranslatedObject = {
      ...app(false),
      translations: [{ 'zh-CN': { objects: { crm_lead: { label: '线索' } } } }],
    };

    expect(flowDemands(app(false))).toEqual([]);
    // The report is live — the same run still speaks about the live groups.
    expect(
      computeI18nCoverage(untranslatedObject).issues.some(
        (i) => i.source === 'field' && i.locale === 'zh-CN',
      ),
    ).toBe(true);
  });

  it('never lets both rules speak about the same keys — the collision itself', () => {
    // Omitting was the branch that drew `i18n/missing-flow`; authoring is the
    // branch that draws the liveness warning. Neither branch may now produce
    // BOTH, and the demand side is silent on both.
    expect(flowDemands(app(false))).toEqual([]);
    expect(flowWarnings(app(false))).toEqual([]);

    expect(flowDemands(app(true))).toEqual([]);
    // ⛔ The warning is true and stays: nothing reads the group, so this copy is
    // stored and never shown. Its rule id says `planned`, i.e. "keep it", not
    // "remove it".
    const warned = flowWarnings(app(true));
    expect(warned.length).toBeGreaterThan(0);
    for (const f of warned) expect(f.rule).toBe('liveness-planned-property');
  });

  it('does not scaffold a skeleton whose every filled-in key would be warned', () => {
    const { bundles } = extractTranslations(app(false), { locales: ['en', 'zh-CN'] });

    expect((bundles.en as any).flows).toBeUndefined();
    // `os i18n extract` is the other door into the same trap, so it is gated by
    // the same read — but only for the warned group.
    expect((bundles.en as any).objects.crm_lead.label).toBe('Lead');
  });

  it('turns itself back on when the row goes `live` — no new switch', () => {
    const keys = collectExpectedEntries(app(false), UNGATED)
      .filter((e) => e.path[0] === 'flows')
      .map((e) => e.path.join('.'))
      .sort();

    expect(keys).toEqual([
      'flows.lead_conversion.label',
      'flows.lead_conversion.screens.conversion_details.fields.create_opportunity.label',
      'flows.lead_conversion.screens.conversion_details.fields.create_opportunity.placeholder',
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
