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

// ── objectstack#17511 — the same hole, one region deep ────────────────────
//
// Everything above walks `flow.nodes` at the TOP level only, which is what the
// walker did: `FlowNode.config` carries ADR-0031 regions (`loop.config.body`,
// `parallel.config.branches[].nodes`, `try_catch.config.try`/`.catch`, nesting
// arbitrarily), and a `type: 'screen'` node inside one is a real screen — the
// executor pauses on it and the client receives its `ScreenSpec.nodeId`, so
// `translateFlow` overlays it (#11745 / PR #17521) and the bundle key is live.
//
// The flat walk reached the container and stopped, so the nested step got NO
// skeleton entry and NO coverage row. That pairing is why the defect outranks
// "untranslated": a missing coverage row reads as "nothing to do here", so the
// gap was invisible to the very mechanism built to report gaps — a silent zero
// rather than a visible failure, the same shape as the #11485 census above one
// level in.
//
// ## The lit control lives in the fixture, not next to it
//
// `welcome` below is a TOP-level screen, reached by the old flat walk too. It
// is in the same flow as the nested ones on purpose: without it, a green on the
// nested keys could be read as "the fixture loaded and the walk ran", and a red
// could be read as "the fixture never loaded at all". With it, the two
// explanations separate — the control asserts the harness, the nested keys
// assert the descent.

/**
 * One flow carrying a screen in EVERY region slot the table declares, and at
 * three different depths, so a descent that handles `loop` but forgets
 * `parallel`'s array-of-regions arity fails on a named key rather than on a
 * count.
 *
 *   welcome          depth 0   (the lit control)
 *   pick_region      depth 1   loop.config.body
 *   accept_terms     depth 2   parallel.config.branches[0]
 *   card_details     depth 3   try_catch.config.try
 *   payment_failed   depth 3   try_catch.config.catch
 */
const nestedOnboarding = {
  name: 'onboarding',
  label: 'Onboarding',
  type: 'screen',
  nodes: [
    { id: 'welcome', type: 'screen', label: 'Welcome', config: { title: 'Welcome aboard' } },
    {
      id: 'per_region',
      type: 'loop',
      label: 'For each region',
      config: {
        body: {
          nodes: [
            {
              id: 'pick_region',
              type: 'screen',
              label: 'Pick Region Step',
              config: {
                title: 'Pick a region',
                fields: [{ name: 'region_code', label: 'Region' }, { name: 'notes' }],
              },
            },
            {
              id: 'fan_out',
              type: 'parallel',
              config: {
                branches: [
                  {
                    name: 'legal',
                    nodes: [{ id: 'accept_terms', type: 'screen', config: { title: 'Accept the terms' } }],
                  },
                  {
                    name: 'billing',
                    nodes: [
                      {
                        id: 'guard_payment',
                        type: 'try_catch',
                        config: {
                          // No `config.title`: the executor draws the node label
                          // for a nested screen exactly as for a top-level one.
                          try: { nodes: [{ id: 'card_details', type: 'screen', label: 'Card Details' }] },
                          catch: { nodes: [{ id: 'payment_failed', type: 'screen', config: { title: 'Payment failed' } }] },
                        },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      },
    },
  ],
  edges: [],
};

/** The #11485 tree shape, with the nested wizard as its only flow. */
const nestedTree = (flowTranslations?: Record<string, unknown>) => ({
  i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] },
  objects: [{ name: 'crm_lead', label: 'Lead', fields: { company: { label: 'Company' } } }],
  flows: [nestedOnboarding],
  translations: [
    {
      'zh-CN': {
        objects: { crm_lead: { label: '线索', fields: { company: { label: '公司' } } } },
        ...(flowTranslations ? { flows: flowTranslations } : {}),
      },
    },
  ],
});

describe('a screen inside an ADR-0031 region (#17511)', () => {
  it('harvests every nested screen, at every region slot and depth', () => {
    // The exact face, so a key that should NOT exist fails here too. Eight of
    // these ten were absent before the descent landed; `flows.onboarding.label`
    // and `screens.welcome.title` are the two the flat walk already reached.
    expect(flowKeys({ flows: [nestedOnboarding] }).sort()).toEqual([
      'flows.onboarding.label',
      'flows.onboarding.screens.accept_terms.title',
      'flows.onboarding.screens.card_details.title',
      'flows.onboarding.screens.payment_failed.title',
      'flows.onboarding.screens.pick_region.fields.notes.label',
      'flows.onboarding.screens.pick_region.fields.notes.placeholder',
      'flows.onboarding.screens.pick_region.fields.region_code.label',
      'flows.onboarding.screens.pick_region.fields.region_code.placeholder',
      'flows.onboarding.screens.pick_region.title',
      'flows.onboarding.screens.welcome.title',
    ]);
  });

  it('gives the coverage gate a row for the nested step, not just the top-level one', () => {
    const zh = userIssues(computeI18nCoverage(nestedTree())).filter((i) => i.locale === 'zh-CN');
    const keys = zh.map((i) => i.key);

    // The control: present before this card, and still present.
    expect(keys).toContain('flows.onboarding.screens.welcome.title');
    // The rows that did not exist — one per region slot the table declares.
    expect(keys).toContain('flows.onboarding.screens.pick_region.title');
    expect(keys).toContain('flows.onboarding.screens.pick_region.fields.region_code.label');
    expect(keys).toContain('flows.onboarding.screens.accept_terms.title');
    expect(keys).toContain('flows.onboarding.screens.card_details.title');
    expect(keys).toContain('flows.onboarding.screens.payment_failed.title');
    // Attributed to the flow bucket, so `os lint` renders `i18n/missing-flow`.
    for (const issue of zh) expect(issue.source).toBe('flow');
    // The object surface IS translated: the whole report is the wizard.
    expect(keys.filter((k) => !k.startsWith('flows.'))).toEqual([]);
  });

  it('seeds a nested screen exactly as a top-level one, never more narrowly', () => {
    const entries = collectExpectedEntries({ flows: [nestedOnboarding] });
    const at = (key: string) => entries.find((e) => e.path.join('.') === key);

    // `title` falls back to the node `label` — `ScreenSpec.title` is
    // `config.title ?? node.label` at every depth, so the nested screen owes
    // the same demand as `summary` does at the top level.
    expect(at('flows.onboarding.screens.card_details.title')).toMatchObject({
      sourceValue: 'Card Details',
      inline: 'Card Details',
      source: 'flow',
    });
    // A nested field's `label` falls back to its `name` as a DERIVED seed:
    // usable skeleton, no demand for a string nobody authored. Getting this
    // wrong is how a region-aware walk starts failing the gate on machine ids.
    expect(at('flows.onboarding.screens.pick_region.fields.notes.label')).toMatchObject({
      sourceValue: 'notes',
      inline: undefined,
    });
    const gated = computeI18nCoverage(nestedTree()).issues.map((i) => i.key);
    expect(gated).not.toContain('flows.onboarding.screens.pick_region.fields.notes.label');
    // And the authored one IS demanded.
    expect(at('flows.onboarding.screens.pick_region.fields.region_code.label')).toMatchObject({
      sourceValue: 'Region',
      inline: 'Region',
    });
  });

  it('scaffolds the nested drill into a bundle the strict schema accepts', () => {
    const result = extractTranslations({ flows: [nestedOnboarding] }, { locales: ['en', 'zh-CN'] });
    const en = result.bundles.en as any;
    const zh = result.bundles['zh-CN'] as any;

    expect(en.flows.onboarding.screens.card_details.title).toBe('Card Details');
    expect(en.flows.onboarding.screens.accept_terms.title).toBe('Accept the terms');
    // The translator's empty slots for the nested steps — the vocabulary that
    // did not exist in the skeleton at all before this card.
    expect(zh.flows.onboarding.screens.payment_failed.title).toBe('');
    // Keyed by node id at the TOP of `screens`, flat: depth is not in the key,
    // because `lookupFlowScreenCopy` is keyed by node id and knows nothing
    // about depth. A region segment here would offer a key nothing reads.
    expect(Object.keys(en.flows.onboarding.screens).sort()).toEqual([
      'accept_terms',
      'card_details',
      'payment_failed',
      'pick_region',
      'welcome',
    ]);
    expect(TranslationDataSchema.safeParse(en).success).toBe(true);
  });

  it('goes quiet once the nested steps are translated', () => {
    const report = computeI18nCoverage(
      nestedTree({
        onboarding: {
          label: '入职',
          screens: {
            welcome: { title: '欢迎' },
            pick_region: { title: '选择区域', fields: { region_code: { label: '区域' } } },
            accept_terms: { title: '接受条款' },
            card_details: { title: '银行卡信息' },
            payment_failed: { title: '支付失败' },
          },
        },
      }),
    );

    expect(userIssues(report)).toEqual([]);
  });

  it('reads the region TABLE, so a `body` that is not a region slot stays unwalked', () => {
    // `config` is an open record and `body` is an ordinary key elsewhere — an
    // `http` node's request payload. `http` owns no slot in
    // `FLOW_REGION_SLOTS_BY_TYPE`, so a screen-shaped object sitting in its
    // payload is data, not a flow node, and must not become a bundle key.
    // This is what consulting the table buys over walking every `body`.
    expect(
      flowKeys({
        flows: [
          {
            name: 'callout',
            label: 'Callout',
            nodes: [
              {
                id: 'post',
                type: 'http',
                config: { body: { nodes: [{ id: 'not_a_screen', type: 'screen', config: { title: 'Payload' } }] } },
              },
            ],
          },
        ],
      }),
    ).toEqual(['flows.callout.label']);
  });

  it('collapses a node id repeated at two depths onto its one bundle slot', () => {
    // The bundle addresses a screen by node id alone, so two screens sharing an
    // id share one slot — one string is all the resolver can overlay onto both.
    // `dedupeByPath` therefore keeps ONE entry, and the walk being
    // outer-before-inner makes which one deterministic.
    const entries = collectExpectedEntries({
      flows: [
        {
          name: 'dup',
          label: 'Dup',
          nodes: [
            { id: 'step', type: 'screen', config: { title: 'Outer' } },
            { id: 'wrap', type: 'loop', config: { body: { nodes: [{ id: 'step', type: 'screen', config: { title: 'Inner' } }] } } },
          ],
        },
      ],
    }).filter((e) => e.path.join('.') === 'flows.dup.screens.step.title');

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ sourceValue: 'Outer' });
  });

  it('terminates on a region that contains itself', () => {
    // A stack handed to `defineStack` is hand-built objects, so a self
    // -referencing region is reachable; the depth ceiling is what keeps this a
    // finite walk rather than a stack overflow on the extract path.
    const loop: any = { id: 'spin', type: 'loop', config: { body: { nodes: [] } } };
    loop.config.body.nodes.push(loop);

    expect(
      flowKeys({
        flows: [{ name: 'cyclic', label: 'Cyclic', nodes: [loop, { id: 'real', type: 'screen', config: { title: 'Reached' } }] }],
      }).sort(),
    ).toEqual(['flows.cyclic.label', 'flows.cyclic.screens.real.title']);
  });
});
