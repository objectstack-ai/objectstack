// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#11485 — the `flows` bucket the coverage taxonomy never had.
//
// ## The defect these pins aim at
//
// A `type: 'screen'` flow is a wizard the user reads. #11287 gave the bundle a
// group for its copy and a resolver that applies it; nothing on the CLI side
// walked it. So `COVERAGE_SOURCE` had no `flow` bucket, `os lint`'s
// `i18n/missing-*` family could not report a screen-flow gap at ALL, and
// `os i18n extract` never scaffolded the keys — an author had no way to even
// discover the vocabulary.
//
// Measured on #11287: HotCRM reported **0 `i18n/missing-*` issues** on a tree
// whose six screen dialogs rendered English in all four locales. An app whose
// i18n gate is green is green because the surface is invisible to it.
//
// So the pin that matters is the FIRST one below — a tree whose object surface
// is fully translated and whose wizard is not must report the wizard. A test
// that merely proved the bucket exists would reproduce the defect one level up.
// Its twin is the second: a fully translated tree reports NOTHING, or the new
// bucket is a noise generator and authors learn to ignore the family.
//
// ## The list is imported, never restated
//
// `FLOW_SCREEN_COPY_KEYS` / `FLOW_SCREEN_FIELD_COPY_KEYS` are exported by
// `@objectstack/spec/system` precisely so the extractor and the resolver cannot
// drift. `translation.test.ts` pins list↔schema spec-side; the `emits exactly
// the spec-exported key face` test below pins list↔walker on this side, so a
// hand-copied list here fails rather than silently offering a key nothing reads.

// ## Why this file simulates a `live` ledger row (#11624)
//
// Everything below is the behaviour of the flow bucket ITSELF — which keys the
// walker harvests, how the coverage report attributes them, what the skeleton
// looks like. None of it changed in #11624. What changed is WHEN it runs: the
// `flows` row in `@objectstack/spec/liveness/translation.json` is `planned` +
// `authorWarn`, and `os lint` runs this bucket in the SAME pass as
// `lintLivenessProperties`, so demanding the keys while the ledger warns
// authors for writing them left the author with no move that satisfies both.
// The bucket is now gated on that row, and it turns itself back on the day an
// objectui screen-flow runner lands and the row flips.
//
// So these pins are re-anchored, not retired: the mock below is the ledger
// warning on nothing, i.e. exactly the post-flip world. Retiring them instead
// would have left the flip with no proof the bucket still works, and a pin that
// "passes" because the walker now emits nothing is the worst of both. The
// GATED half — that none of this reaches an author while the row is `planned`
// — is pinned next door in `i18n-flow-liveness-gate.test.ts`, against the real
// shipped ledger.
//
// The mock is fail-loud: if it stopped applying, every `expect(...).toContain`
// below would go red rather than silently assert over an empty walk.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@objectstack/lint', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@objectstack/lint')>()),
  // The post-flip ledger: no translation group warns an author any more.
  authorWarnedProperties: () => new Set<string>(),
}));

import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage, type CoverageIssue, type CoverageReport } from '../src/utils/i18n-coverage.js';
import {
  FLOW_SCREEN_COPY_KEYS,
  FLOW_SCREEN_FIELD_COPY_KEYS,
  TranslationDataSchema,
} from '@objectstack/spec/system';

/**
 * The lead-conversion wizard, in the shape the schema's own `flows` note cites
 * as the #7646 report ("Conversion Details / Create Opportunity? / Opportunity
 * Name" rendered in English on a zh-CN console).
 */
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
        // Body text is guidance-REFUSED by the schema: it must not become a key.
        description: 'Choose what this lead becomes.',
        fields: [
          { name: 'create_opportunity', label: 'Create Opportunity?', type: 'boolean' },
          { name: 'opportunity_name', label: 'Opportunity Name', placeholder: 'Acme - Q3 renewal' },
        ],
      },
    },
    // No `config.title`: the executor draws the node label, so one key covers both.
    { id: 'summary', type: 'screen', label: 'Summary', config: { waitForInput: true } },
  ],
  edges: [],
};

/** A tree whose OBJECT surface is completely translated — HotCRM's state. */
const hotCrmLike = (flowTranslations?: Record<string, unknown>) => ({
  i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
  objects: [{ name: 'crm_lead', label: 'Lead', fields: { company: { label: 'Company' } } }],
  flows: [leadConversion],
  translations: [
    {
      'zh-CN': {
        objects: { crm_lead: { label: '线索', fields: { company: { label: '公司' } } } },
        ...(flowTranslations ? { flows: flowTranslations } : {}),
      },
    },
  ],
});

/** Only the user's own metadata; `os lint` folds the platform baseline away. */
const userIssues = (report: CoverageReport): CoverageIssue[] =>
  report.issues.filter((i) => i.source !== 'metadataForm');

const flowKeys = (config: any) =>
  collectExpectedEntries(config)
    .filter((e) => e.path[0] === 'flows')
    .map((e) => e.path.join('.'));

describe('the screen-flow gap a green i18n gate could not see (#11485)', () => {
  it('reports every untranslated wizard string on a tree whose objects are done', () => {
    // `userIssues` first: the ~850-key Studio metadata-form baseline is
    // platform noise `os lint` folds away, and it is present in every report.
    const zh = userIssues(computeI18nCoverage(hotCrmLike())).filter((i) => i.locale === 'zh-CN');
    const keys = zh.map((i) => i.key);

    // The exact strings the console renders in English.
    expect(keys).toContain('flows.lead_conversion.label');
    expect(keys).toContain('flows.lead_conversion.screens.conversion_details.title');
    expect(keys).toContain('flows.lead_conversion.screens.conversion_details.fields.create_opportunity.label');
    expect(keys).toContain('flows.lead_conversion.screens.conversion_details.fields.opportunity_name.label');
    expect(keys).toContain('flows.lead_conversion.screens.conversion_details.fields.opportunity_name.placeholder');
    // The object surface IS translated, so nothing else is reported: the whole
    // report is the wizard. Before this bucket the same tree reported zero.
    expect(zh.length).toBeGreaterThan(0);
    expect(keys.filter((k) => !k.startsWith('flows.'))).toEqual([]);
  });

  it('attributes them to the flow bucket so `os lint` renders `i18n/missing-flow`', () => {
    const zh = computeI18nCoverage(hotCrmLike()).issues.filter(
      (i) => i.locale === 'zh-CN' && i.key.startsWith('flows.'),
    );

    expect(zh.length).toBeGreaterThan(0);
    for (const issue of zh) expect(issue.source).toBe('flow');
    // The message names the flow, not a bare dot-path.
    expect(zh.map((i) => i.message)).toContain(
      'Flow "lead_conversion" screens.conversion_details.title missing translation for locale "zh-CN"',
    );
  });

  it('goes quiet once the wizard is translated — the bucket is not a noise generator', () => {
    const report = computeI18nCoverage(
      hotCrmLike({
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
            summary: { title: '完成' },
          },
        },
      }),
    );

    expect(userIssues(report)).toEqual([]);
  });

  it('stays silent for a monolingual project that never opted into i18n', () => {
    // The opt-in half of the contract: no `i18n` block, no bundle, so a project
    // that does not translate must not start failing lint for a flow it wrote.
    const report = computeI18nCoverage({ flows: [leadConversion] });

    expect(report.locales).toEqual(['en']);
    expect(userIssues(report)).toEqual([]);
  });
});

describe('what the walker harvests from a screen flow', () => {
  it('keys screens by `FlowNode.id` and fields by `ScreenFieldConfig.name`', () => {
    expect(flowKeys({ flows: [leadConversion] }).sort()).toEqual([
      'flows.lead_conversion.label',
      'flows.lead_conversion.screens.conversion_details.fields.create_opportunity.label',
      'flows.lead_conversion.screens.conversion_details.fields.create_opportunity.placeholder',
      'flows.lead_conversion.screens.conversion_details.fields.opportunity_name.label',
      'flows.lead_conversion.screens.conversion_details.fields.opportunity_name.placeholder',
      'flows.lead_conversion.screens.conversion_details.title',
      'flows.lead_conversion.screens.summary.title',
    ]);
  });

  it('falls the screen title back to the node label, the way the executor does', () => {
    // `ScreenSpec.title` is `config.title ?? node.label`, so a screen with only
    // a canvas label still shows English text somebody owes a translation for.
    const summary = collectExpectedEntries({ flows: [leadConversion] }).find(
      (e) => e.path.join('.') === 'flows.lead_conversion.screens.summary.title',
    );

    expect(summary).toMatchObject({ sourceValue: 'Summary', inline: 'Summary', source: 'flow' });
  });

  it('seeds an unlabelled field from its name without demanding a translation for it', () => {
    // `ScreenFieldConfig.label` is optional and forwarded as-is, so the runner
    // renders the name. The skeleton stays usable (`sourceValue`) while the gate
    // demands nothing (`inline` unset) — a missing label is `required/label`'s
    // finding, not an i18n gap.
    const config = {
      i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
      flows: [
        {
          name: 'quick_capture',
          label: 'Quick Capture',
          type: 'screen',
          nodes: [{ id: 'ask', type: 'screen', label: 'Ask', config: { fields: [{ name: 'amount' }] } }],
        },
      ],
    };
    const entry = collectExpectedEntries(config).find(
      (e) => e.path.join('.') === 'flows.quick_capture.screens.ask.fields.amount.label',
    );
    const gated = computeI18nCoverage(config).issues.map((i) => i.key);

    expect(entry).toMatchObject({ sourceValue: 'amount', inline: undefined });
    expect(gated).not.toContain('flows.quick_capture.screens.ask.fields.amount.label');
  });

  it('harvests nothing from non-screen nodes, id-less screens or nameless flows', () => {
    expect(
      flowKeys({
        flows: [
          {
            name: 'housekeeping',
            label: 'Housekeeping',
            nodes: [
              { id: 'start', type: 'start', label: 'Start' },
              { id: 'notify', type: 'send_email', label: 'Notify', config: { title: 'Not a screen' } },
              { type: 'screen', label: 'Anonymous', config: { title: 'Unaddressable' } },
            ],
          },
          { label: 'No name at all', nodes: [{ id: 's', type: 'screen', label: 'Orphan' }] },
        ],
      }),
    ).toEqual(['flows.housekeeping.label']);
  });

  it('never emits the keys the schema refuses by name', () => {
    const keys = flowKeys({ flows: [leadConversion] });

    // `description` is a screen's body text — guidance-refused spec-side.
    expect(keys.filter((k) => k.endsWith('.description'))).toEqual([]);
    // Runner chrome and per-field `help` / `options` are refused too.
    expect(keys.filter((k) => /\.(help|helpText|options|successMessage|errorMessage)$/.test(k))).toEqual([]);
  });
});

describe('`os i18n extract` scaffolds the flows skeleton', () => {
  const result = extractTranslations({ flows: [leadConversion] }, { locales: ['en', 'zh-CN'] });
  const en = result.bundles.en as any;
  const zh = result.bundles['zh-CN'] as any;

  it('writes the whole `flows..screens..` drill for every requested locale', () => {
    expect(en.flows.lead_conversion.label).toBe('Convert Lead');
    expect(en.flows.lead_conversion.screens.conversion_details.title).toBe('Conversion Details');
    expect(en.flows.lead_conversion.screens.conversion_details.fields.opportunity_name).toEqual({
      label: 'Opportunity Name',
      placeholder: 'Acme - Q3 renewal',
    });
    // The translator's empty slots — the vocabulary an author had no way to
    // discover before this pass existed.
    expect(zh.flows.lead_conversion.screens.conversion_details.title).toBe('');
    expect(zh.flows.lead_conversion.screens.summary.title).toBe('');
  });

  it('emits exactly the spec-exported key face — the import that stops the drift', () => {
    const screen = en.flows.lead_conversion.screens.conversion_details;

    expect(Object.keys(screen).filter((k) => k !== 'fields').sort()).toEqual([...FLOW_SCREEN_COPY_KEYS].sort());
    expect(Object.keys(screen.fields.opportunity_name).sort()).toEqual([...FLOW_SCREEN_FIELD_COPY_KEYS].sort());
  });

  it('scaffolds a bundle the strict schema accepts', () => {
    // A skeleton the schema refuses is worse than none: the author pastes it in
    // and the whole bundle stops parsing. `strictObject` means an unrecognised
    // key here would be a hard rejection, so this parse is the key-face check.
    const parsed = TranslationDataSchema.safeParse(en);

    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it('matches `--filter` against the flow name', () => {
    const filtered = extractTranslations(
      { flows: [leadConversion], objects: [{ name: 'crm_lead', label: 'Lead' }] },
      { filter: /^lead_conversion$/ },
    );

    expect((filtered.bundles.en as any).flows.lead_conversion.label).toBe('Convert Lead');
    expect((filtered.bundles.en as any).objects).toBeUndefined();
  });
});
