// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#14376, family 2 of 3 — `objects.<o>._validations.<rule>.message`.
//
// #14253 gave an author-written `validations[].message` its first bundle
// address: `objectValidationMessageKey` spells it, and the ObjectQL rule
// evaluator resolves it through the engine's EXISTING `i18nService` channel, so
// a rejected write returns the author's sentence in the caller's language the
// way the built-in field catalog already does. The EXTRACTOR did not walk it, so
// `os i18n extract` scaffolded nothing and `check:i18n-coverage` — which
// measures against this walk — could not see the family at all.
//
// The shape that decides this file: a `conditional` rule contributes NO key of
// its own. `checkConditional` evaluates `when` and returns the BRANCH's
// violation, so the wrapper's `message` never reaches a user; the branches carry
// their own `name` and are addressed by it.

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { ObjectTranslationDataSchema } from '@objectstack/spec/system';

/** Every `objects.<o>._validations.*` path the walker emits, as dot-paths. */
const ruleKeys = (config: any): string[] =>
  collectExpectedEntries(config)
    .filter((e) => e.path[2] === '_validations')
    .map((e) => e.path.join('.'));

const ruleEntries = (config: any) =>
  collectExpectedEntries(config).filter((e) => e.path[2] === '_validations');

/** The `examples/app-crm` opportunity shape: a script rule with admin prose. */
const objectConfig = (validations?: unknown[]) => ({
  objects: [
    {
      name: 'crm_opportunity',
      label: 'Opportunity',
      validations: validations ?? [
        {
          type: 'script',
          name: 'discount_cap',
          label: 'Discount Cap 40%',
          description: 'Discounts over 40% require special approval.',
          condition: 'record.discount_percent > 40',
          message: 'Discount cannot exceed 40% without an approved exception.',
          severity: 'error',
        },
        {
          type: 'cross_field',
          name: 'opp_close_date_not_past',
          fields: ['close_date'],
          condition: 'record.close_date < now()',
          message: 'Close Date must be today or a future date.',
        },
      ],
    },
  ],
});

describe('the extractor scaffolds a key for every authored rejection sentence', () => {
  it('emits `objects.<o>._validations.<rule>.message`', () => {
    expect(ruleKeys(objectConfig()).sort()).toEqual([
      'objects.crm_opportunity._validations.discount_cap.message',
      'objects.crm_opportunity._validations.opp_close_date_not_past.message',
    ]);
  });

  it('seeds the entry with the authored sentence', () => {
    const entry = ruleEntries(objectConfig()).find((e) => e.path[3] === 'discount_cap');
    expect(entry?.sourceValue).toBe('Discount cannot exceed 40% without an approved exception.');
    expect(entry?.inline).toBe('Discount cannot exceed 40% without an approved exception.');
    expect(entry?.objectName).toBe('crm_opportunity');
  });

  it('emits `message` and nothing else — `label` and `description` are not user copy', () => {
    // A rule's `label` is its entry in the admin rule listing and `description`
    // is the maintainer's note; neither reaches a rejected caller, so a key for
    // either would parse clean and translate nothing. The schema carries
    // `guidance` against both rather than a slot.
    const keys = ruleKeys(objectConfig());
    expect(keys.every((k) => k.endsWith('.message'))).toBe(true);
  });

  it('addresses a conditional rule by its BRANCH, never by the wrapper', () => {
    // `checkConditional` returns `evaluateRule(branch, …)` — the branch supplies
    // the violation the caller sees. Scaffolding the wrapper's own `message`
    // would offer a translator a string no rejected write can show.
    const keys = ruleKeys(
      objectConfig([
        {
          type: 'conditional',
          name: 'enterprise_approval_required',
          when: 'record.tier = "enterprise"',
          message: 'Enterprise validation',
          then: {
            type: 'script',
            name: 'require_approval',
            message: 'Enterprise accounts require manager approval',
          },
          otherwise: {
            type: 'script',
            name: 'standard_approval',
            message: 'Standard accounts need a reviewer',
          },
        },
      ]),
    );
    expect(keys.sort()).toEqual([
      'objects.crm_opportunity._validations.require_approval.message',
      'objects.crm_opportunity._validations.standard_approval.message',
    ]);
  });

  it('follows a nested conditional down to the branch that speaks', () => {
    const keys = ruleKeys(
      objectConfig([
        {
          type: 'conditional',
          name: 'country_state_validation',
          when: 'record.country = "US"',
          message: 'US-specific validation',
          then: {
            type: 'conditional',
            name: 'california_validation',
            when: 'record.state = "CA"',
            message: 'California-specific validation',
            then: {
              type: 'script',
              name: 'ca_tax_id_required',
              message: 'California requires a valid tax ID',
            },
          },
        },
      ]),
    );
    expect(keys).toEqual(['objects.crm_opportunity._validations.ca_tax_id_required.message']);
  });

  it('still emits for a rule switched off', () => {
    // `active: false` is a toggle on a surface that exists, not the absence of
    // one, and no other family in this walker consults a runtime toggle.
    // Flipping it back on must not silently owe a translation.
    const keys = ruleKeys(
      objectConfig([
        { type: 'script', name: 'paused_rule', active: false, message: 'Paused but declared.' },
      ]),
    );
    expect(keys).toEqual(['objects.crm_opportunity._validations.paused_rule.message']);
  });

  it('skips a rule with no `name` — the key it would be addressed by', () => {
    expect(ruleKeys(objectConfig([{ type: 'script', message: 'Nameless.' }]))).toEqual([]);
  });

  it('emits nothing for an object that declares no validations', () => {
    expect(ruleKeys({ objects: [{ name: 'crm_opportunity', label: 'Opportunity' }] })).toEqual([]);
  });
});

describe('the emitted key is the key the schema declares', () => {
  it('`ObjectTranslationDataSchema` accepts a bundle written at the extracted path', () => {
    const keys = ruleKeys(objectConfig());
    expect(keys.length).toBeGreaterThan(0);
    const data: Record<string, { message: string }> = {};
    for (const key of keys) data[key.split('.')[3]] = { message: '折扣不能超过 40%。' };

    expect(() => ObjectTranslationDataSchema.parse({ _validations: data })).not.toThrow();
  });

  it('a rule `label` is still rejected there — the slot did not go open', () => {
    expect(() =>
      ObjectTranslationDataSchema.parse({
        _validations: { discount_cap: { message: 'ok', label: 'Discount Cap' } },
      }),
    ).toThrow();
  });
});

describe('coverage', () => {
  const config = () => ({
    ...objectConfig(),
    i18n: { supportedLocales: ['en', 'zh-CN'] },
    translations: [
      {
        'zh-CN': {
          objects: {
            crm_opportunity: { _validations: { discount_cap: { message: '折扣不能超过 40%。' } } },
          },
        },
      },
    ],
  });

  const ruleIssues = (report: { issues: Array<{ key: string; source: string }> }) =>
    report.issues.filter((i) => i.key.includes('._validations.'));

  it('reports the untranslated rule and stays quiet about the translated one', () => {
    expect(ruleIssues(computeI18nCoverage(config())).map((i) => i.key)).toEqual([
      'objects.crm_opportunity._validations.opp_close_date_not_past.message',
    ]);
  });

  it('files the finding under the object bucket', () => {
    // The address is object-scoped (`objects.<o>._validations.…`), beside
    // `_views` / `_actions` / `_tabs`, so it reports as `i18n/missing-object`.
    expect(ruleIssues(computeI18nCoverage(config())).every((i) => i.source === 'object')).toBe(true);
  });

  it('a project that declares no locales still reports nothing', () => {
    expect(ruleIssues(computeI18nCoverage(objectConfig()))).toEqual([]);
  });

  it('`extractTranslations` writes the rule keys into the skeleton', () => {
    const out = extractTranslations(objectConfig(), { locales: ['zh-CN'] });
    const zh = out.bundles['zh-CN'] as any;
    expect(zh?.objects?.crm_opportunity?._validations?.discount_cap?.message).toBeDefined();
  });
});
