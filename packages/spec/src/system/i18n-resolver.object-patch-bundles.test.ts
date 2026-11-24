// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: a field slot a CODE package's `fieldPatches` wrote reads that
 * package's own translations (`TranslateDocumentOptions.patchBundles`,
 * #33952, ruling 6942920667 on the card): the pair's translation first, then
 * the patching package's, then the served text. The owner's translation —
 * what the merged deployment catalog may hold under the same key — never
 * applies to a patched slot (#29564 stays fixed).
 *
 * Before: a patched slot read only the pair's catalog, so a dependent
 * package's patched label, help text and option label were served as written
 * in every locale, whatever that package shipped for them.
 *
 * Every bundle here is PARSED by `TranslationBundleSchema`, so each entry sits
 * at an address the schema carries.
 */

import { describe, it, expect } from 'vitest';
import { translateMetadataDocument, translateObject, type TranslateDocumentOptions } from './i18n-resolver';
import { TranslationBundleSchema, type TranslationBundle } from './translation.zod';

const OBJ = 'crm_account';

const bundle = (raw: unknown): TranslationBundle => TranslationBundleSchema.parse(raw);

/** The owner's declaration: the packaged base every served read compares against. */
function owner(): any {
  return {
    name: OBJ,
    label: 'Account',
    fields: {
      registration_number: {
        name: 'registration_number',
        type: 'text',
        label: 'Registration Number',
        description: 'Company registry id.',
      },
      tier: {
        name: 'tier',
        type: 'select',
        label: 'Tier',
        options: [
          { value: 'gold', label: 'Gold' },
          { value: 'silver', label: 'Silver' },
        ],
      },
      region: { name: 'region', type: 'text', label: 'Region', inlineHelpText: 'Sales region.' },
    },
  };
}

/** `base` with `patch` applied to its fields, the way the registry's fold applies one package's `fieldPatches`. */
function patched(base: any, patch: Record<string, any>): any {
  const out = structuredClone(base);
  for (const [name, p] of Object.entries(patch)) {
    const field = out.fields[name];
    for (const [key, value] of Object.entries(p)) {
      if (key === 'options') {
        for (const option of field.options) {
          const label = (value as any)[option.value]?.label;
          if (label !== undefined) option.label = label;
        }
      } else {
        field[key] = value;
      }
    }
  }
  return out;
}

const PATCH = {
  registration_number: { label: 'Tax ID', description: 'Unified social credit code.' },
  tier: { options: { gold: { label: 'Platinum' } } },
  region: { inlineHelpText: 'Province.' },
};

/**
 * The deployment catalog: the owner's translations of the OWNER's text under
 * the very keys the patch's text is translated under — what the merged
 * catalog holds when the owner's pack loaded last.
 */
const DEPLOYMENT = bundle({
  'zh-CN': {
    objects: {
      [OBJ]: {
        label: '客户',
        fields: {
          registration_number: { label: '注册号', help: '公司注册编号。' },
          tier: { label: '等级', options: { gold: '黄金', silver: '白银' } },
          region: { label: '区域', help: '销售区域。' },
        },
      },
    },
  },
});

/** The patching package's own translations of the text its patch writes. */
const DEPENDENT = bundle({
  'zh-CN': {
    objects: {
      [OBJ]: {
        fields: {
          registration_number: { label: '税号', help: '统一社会信用代码。' },
          tier: { options: { gold: '铂金' } },
          region: { help: '省份。' },
        },
      },
    },
  },
});

const served = () => patched(owner(), PATCH);
const run = (doc: any, opts: TranslateDocumentOptions) =>
  translateObject(doc, DEPLOYMENT, { packagedBase: owner(), ...opts }) as any;
const read = (out: any) => ({
  label: out.fields.registration_number.label,
  description: out.fields.registration_number.description,
  gold: out.fields.tier.options[0].label,
  silver: out.fields.tier.options[1].label,
  regionHelp: out.fields.region.inlineHelpText,
  tierLabel: out.fields.tier.label,
  objectLabel: out.label,
});

describe('a code package\'s fieldPatches slot reads that package\'s own translations (#33952)', () => {
  it('the patched label, help text and option label read the patching package\'s zh-CN; the slots it leaves alone read the deployment catalog', () => {
    const out = run(served(), {
      locale: 'zh-CN',
      patchBundles: [{ patchedBase: patched(owner(), PATCH), bundle: DEPENDENT }],
    });
    expect(read(out)).toEqual({
      label: '税号',
      description: '统一社会信用代码。',
      gold: '铂金',
      silver: '白银',
      regionHelp: '省份。',
      tierLabel: '等级',
      objectLabel: '客户',
    });
  });

  it('without patchBundles a patched slot keeps its own text, as before — the owner\'s translation never applies to it', () => {
    for (const opts of [{}, { patchBundles: [] }] as TranslateDocumentOptions[]) {
      expect(read(run(served(), { locale: 'zh-CN', ...opts }))).toEqual({
        label: 'Tax ID',
        description: 'Unified social credit code.',
        gold: 'Platinum',
        silver: '白银',
        regionHelp: 'Province.',
        tierLabel: '等级',
        objectLabel: '客户',
      });
    }
  });

  it('a locale the patching package does not translate keeps the patch text, never the owner\'s translation of the text it replaced', () => {
    const out = run(served(), {
      locale: 'zh-CN',
      patchBundles: [{ patchedBase: patched(owner(), PATCH), bundle: bundle({ 'ja-JP': { objects: { [OBJ]: { fields: { registration_number: { label: '税番号' } } } } } }) }],
    });
    expect([out.fields.registration_number.label, out.fields.tier.options[0].label]).toEqual(['Tax ID', 'Platinum']);
  });

  it('a value no entry wrote (a tenant\'s rename on top of the patch) keeps its own text', () => {
    const doc = served();
    doc.fields.registration_number.label = 'Tenant label';
    doc.fields.tier.options[0].label = 'Tenant gold';
    const out = run(doc, {
      locale: 'zh-CN',
      patchBundles: [{ patchedBase: patched(owner(), PATCH), bundle: DEPENDENT }],
    });
    expect([out.fields.registration_number.label, out.fields.tier.options[0].label, out.fields.registration_number.description])
      .toEqual(['Tenant label', 'Tenant gold', '统一社会信用代码。']);
  });

  it('two patching packages: each slot reads the package whose text it carries, the first entry first', () => {
    const high = { registration_number: { label: 'Tax ID' } };
    const low = { registration_number: { label: 'Legacy ID', description: 'Unified social credit code.' } };
    // The fold applies the lower package first, so the served label is the higher one's.
    const doc = patched(patched(owner(), low), high);
    const out = run(doc, {
      locale: 'zh-CN',
      patchBundles: [
        { patchedBase: patched(owner(), high), bundle: bundle({ 'zh-CN': { objects: { [OBJ]: { fields: { registration_number: { label: '税号(高)', help: '高' } } } } } }) },
        { patchedBase: patched(owner(), low), bundle: bundle({ 'zh-CN': { objects: { [OBJ]: { fields: { registration_number: { label: '旧号(低)', help: '统一社会信用代码(低)' } } } } } }) },
      ],
    });
    expect([out.fields.registration_number.label, out.fields.registration_number.description])
      .toEqual(['税号(高)', '统一社会信用代码(低)']);
  });

  it('the pair\'s translation keeps the first rank, locale by locale', () => {
    const pairBundle = bundle({
      en: { objects: { [OBJ]: { fields: { tier: { options: { gold: 'Pair Platinum' } } } } } },
      'zh-CN': { objects: { [OBJ]: { fields: { registration_number: { label: '配对税号' } } } } },
    });
    const out = run(served(), {
      locale: 'zh-CN',
      fallbackChain: ['en'],
      pairBundle,
      patchBundles: [{ patchedBase: patched(owner(), PATCH), bundle: DEPENDENT }],
    });
    // The pair's zh-CN wins its slot; its `en` never displaces the package's zh-CN.
    expect([out.fields.registration_number.label, out.fields.tier.options[0].label]).toEqual(['配对税号', '铂金']);
  });

  it('an entry with no object base is no evidence of anything, and no packagedBase means nothing counts as patched', () => {
    const noBase = run(served(), { locale: 'zh-CN', patchBundles: [{ patchedBase: undefined, bundle: DEPENDENT }] });
    expect([noBase.fields.registration_number.label, noBase.fields.tier.options[0].label]).toEqual(['Tax ID', 'Platinum']);
    const noPackaged = translateObject(served(), DEPLOYMENT, {
      locale: 'zh-CN',
      patchBundles: [{ patchedBase: patched(owner(), PATCH), bundle: DEPENDENT }],
    }) as any;
    // No packaged base known: the catalog applies unconditionally, as before #8284.
    expect(noPackaged.fields.registration_number.label).toBe('注册号');
  });

  it('translateMetadataDocument hands the option to the object translator', () => {
    const out = translateMetadataDocument('object', served(), DEPLOYMENT, {
      locale: 'zh-CN',
      packagedBase: owner(),
      patchBundles: [{ patchedBase: patched(owner(), PATCH), bundle: DEPENDENT }],
    }) as any;
    expect(out.fields.registration_number.label).toBe('税号');
  });
});
