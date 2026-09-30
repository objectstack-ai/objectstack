// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  PicklistSchema,
  PicklistExtensionSchema,
  PicklistServedFieldSchema,
  definePicklist,
} from './picklist.zod';
import { Field, FieldSchema } from './field.zod';
import { checkFieldCompleteness } from '../kernel/functional-completeness';
import {
  DEFAULT_METADATA_TYPE_REGISTRY,
  MetadataTypeSchema,
} from '../kernel/metadata-plugin.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';
import { PLURAL_TO_SINGULAR } from '../meta-spelling/manifest-collection-spelling';
import { ObjectStackDefinitionSchema, composeStacks, defineStack } from '../stack.zod';
import { TranslationDataSchema } from '../system/translation.zod';
import {
  TRANSLATABLE_METADATA_TYPES,
  translateObject,
  translatePicklist,
} from '../system/i18n-resolver';

const INDUSTRY = {
  name: 'industry',
  label: 'Industry',
  options: [
    { label: 'Technology', value: 'technology' },
    { label: 'Finance', value: 'finance' },
  ],
};

/** The issues a failed parse carries, as `path.join('.')` → issue. */
function issuesByPath(result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; code: string; message: string }> } }) {
  expect(result.success).toBe(false);
  return new Map(result.error!.issues.map((i) => [i.path.join('.'), i]));
}

describe('picklist — the kind', () => {
  it('parses the ruled shape { name, label, description?, options: SelectOption[] }', () => {
    const parsed = PicklistSchema.parse({ ...INDUSTRY, description: 'What a company does' });
    expect(parsed.name).toBe('industry');
    expect(parsed.options.map((o) => o.value)).toEqual(['technology', 'finance']);
    expect(definePicklist(INDUSTRY).label).toBe('Industry');
  });

  it('takes the field option shape verbatim — color / default / visibleWhen ride along', () => {
    const parsed = PicklistSchema.parse({
      ...INDUSTRY,
      options: [{ label: 'Tech', value: 'technology', color: '#0af', default: true, visibleWhen: "record.region == 'emea'" }],
    });
    expect(parsed.options[0].color).toBe('#0af');
    expect(parsed.options[0].default).toBe(true);
  });

  it('refuses an empty list at `options`', () => {
    const issues = issuesByPath(PicklistSchema.safeParse({ ...INDUSTRY, options: [] }));
    expect(issues.get('options')?.code).toBe('too_small');
  });

  it('refuses a non-snake_case name at `name`', () => {
    const issues = issuesByPath(PicklistSchema.safeParse({ ...INDUSTRY, name: 'Industry' }));
    expect(issues.has('name')).toBe(true);
  });

  it('is a closed shape — an undeclared key is refused, not stripped', () => {
    const issues = issuesByPath(PicklistSchema.safeParse({ ...INDUSTRY, restricted: true }));
    expect([...issues.values()].some((i) => i.code === 'unrecognized_keys')).toBe(true);
  });
});

describe('picklistExtensions — additive only', () => {
  it('parses { extend, options }', () => {
    const parsed = PicklistExtensionSchema.parse({
      extend: 'industry',
      options: [{ label: 'Healthcare', value: 'healthcare' }],
    });
    expect(parsed.extend).toBe('industry');
  });

  it('declares no key that removes or relabels — `remove` is refused as an unknown key', () => {
    const issues = issuesByPath(PicklistExtensionSchema.safeParse({
      extend: 'industry',
      options: [{ label: 'Healthcare', value: 'healthcare' }],
      remove: ['finance'],
    }));
    const unknown = [...issues.values()].find((i) => i.code === 'unrecognized_keys');
    expect(unknown?.message).toContain('remove');
  });

  it('refuses an extension that adds nothing', () => {
    const issues = issuesByPath(PicklistExtensionSchema.safeParse({ extend: 'industry', options: [] }));
    expect(issues.get('options')?.code).toBe('too_small');
  });
});

describe('Field `picklist` — mutually exclusive with `options` at the schema door', () => {
  it('a select that names a picklist parses, with no options of its own', () => {
    const parsed = FieldSchema.parse({ name: 'industry', label: 'Industry', type: 'select', picklist: 'industry' });
    expect(parsed.picklist).toBe('industry');
    expect(parsed.options).toBeUndefined();
  });

  it('`Field.select({ picklist })` builds the reference form and it parses', () => {
    const def = Field.select({ picklist: 'industry', label: 'Industry' });
    expect(def).toEqual({ type: 'select', picklist: 'industry', label: 'Industry' });
    expect(FieldSchema.safeParse(def).success).toBe(true);
  });

  it('`picklist` + `options` together is refused at `options`', () => {
    const issues = issuesByPath(FieldSchema.safeParse({
      name: 'industry', label: 'Industry', type: 'select',
      picklist: 'industry', options: [{ label: 'Tech', value: 'technology' }],
    }));
    const both = issues.get('options');
    expect(both?.code).toBe('custom');
    expect(both?.message).toContain('`picklist`');
  });

  it('`Field.select` handed both keeps both, so the pair still reaches the refusal', () => {
    const def = Field.select({
      picklist: 'industry', label: 'Industry', options: [{ label: 'Tech', value: 'technology' }],
    } as Parameters<typeof Field.select>[0]);
    expect(FieldSchema.safeParse(def).success).toBe(false);
  });

  it.each(['select', 'radio'] as const)('neither on a %s is the completeness gate\'s error, not a parse refusal', (type) => {
    // The schema door refuses only the pair. An optionless single-choice field
    // keeps the verdict it had before the kind existed: parse-legal, and an
    // error-severity `field/choice-without-options` finding at the author-time
    // and registry gates — which a `picklist` reference now satisfies.
    expect(FieldSchema.safeParse({ name: 'f', label: 'F', type }).success).toBe(true);
    expect(checkFieldCompleteness({ type }).map((f) => [f.rule, f.severity]))
      .toEqual([['field/choice-without-options', 'error']]);
    expect(checkFieldCompleteness({ type, picklist: 'industry' })).toEqual([]);
  });

  it.each(['select', 'radio', 'multiselect', 'checkboxes', 'tags'] as const)('`picklist` is accepted on the option type %s', (type) => {
    expect(FieldSchema.safeParse({ name: 'f', label: 'F', type, picklist: 'industry' }).success).toBe(true);
  });

  it.each(['text', 'lookup', 'number'] as const)('`picklist` on the non-option type %s is refused at `picklist`', (type) => {
    const fixture = type === 'lookup'
      ? { name: 'f', label: 'F', type, reference: 'account', picklist: 'industry' }
      : { name: 'f', label: 'F', type, picklist: 'industry' };
    const issues = issuesByPath(FieldSchema.safeParse(fixture));
    expect(issues.get('picklist')?.code).toBe('custom');
  });

});

describe('the served shape — `options` resolved, `picklist` kept', () => {
  const served = {
    name: 'industry', label: 'Industry', type: 'select', picklist: 'industry',
    options: [...INDUSTRY.options, { label: 'Healthcare', value: 'healthcare' }],
  };

  it('a served picklist-bound field carries the resolved options and passes the rest through', () => {
    const parsed = PicklistServedFieldSchema.parse(served) as Record<string, unknown>;
    expect(parsed.picklist).toBe('industry');
    expect((parsed.options as Array<{ value: string }>).map((o) => o.value))
      .toEqual(['technology', 'finance', 'healthcare']);
    expect(parsed.label).toBe('Industry');
  });

  it('a served field with the reference unresolved (no options) breaks the contract', () => {
    const { options: _omit, ...unresolved } = served;
    const issues = issuesByPath(PicklistServedFieldSchema.safeParse(unresolved));
    expect(issues.has('options')).toBe(true);
  });

  it('the served form is not an authoring input — the field door refuses the pair', () => {
    expect(FieldSchema.safeParse(served).success).toBe(false);
  });
});

describe('picklist — a registered kind and a stack collection', () => {
  const entry = DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === 'picklist');
  const objectEntry = DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === 'object');

  it('is a member of the kind enum and resolves its schema', () => {
    expect(MetadataTypeSchema.safeParse('picklist').success).toBe(true);
    expect(getMetadataTypeSchema('picklist')).toBe(PicklistSchema);
  });

  it('loads before `object`, whose fields reference it', () => {
    expect(entry).toBeDefined();
    expect(entry!.loadOrder).toBeLessThan(objectEntry!.loadOrder);
  });

  it('is package-owned: no runtime create, no per-org overlay; `*.picklist.ts` is the prescription', () => {
    expect(entry!.allowRuntimeCreate).toBe(false);
    expect(entry!.allowOrgOverride).toBe(false);
    expect(entry!.filePatterns[0]).toBe('**/*.picklist.ts');
  });

  it('`picklists` folds to the kind name', () => {
    expect(PLURAL_TO_SINGULAR.picklists).toBe('picklist');
  });

  it('a stack declares picklists, extensions, and a field that references one', () => {
    const stack = ObjectStackDefinitionSchema.parse({
      manifest: { id: 'com.example.crm', name: 'crm', version: '1.0.0', type: 'app' },
      picklists: [INDUSTRY],
      picklistExtensions: [{ extend: 'industry', options: [{ label: 'Healthcare', value: 'healthcare' }] }],
      objects: [{
        name: 'account',
        label: 'Account',
        fields: { industry: Field.select({ picklist: 'industry', label: 'Industry' }) },
      }],
    });
    expect(stack.picklists?.[0].name).toBe('industry');
    expect(stack.picklistExtensions?.[0].extend).toBe('industry');
  });

  it('composing two stacks concatenates both collections', () => {
    const a = defineStack({ picklists: [INDUSTRY] }, { strict: false });
    const b = defineStack({
      picklists: [{ ...INDUSTRY, name: 'region', label: 'Region' }],
      picklistExtensions: [{ extend: 'industry', options: [{ label: 'Retail', value: 'retail' }] }],
    }, { strict: false });
    const composed = composeStacks([a, b]);
    expect(composed.picklists?.map((p) => p.name)).toEqual(['industry', 'region']);
    expect(composed.picklistExtensions).toHaveLength(1);
  });
});

describe('the translation face — `picklists.<name>`', () => {
  const bundle = {
    'zh-CN': {
      picklists: {
        industry: { label: '行业', options: { technology: '科技', finance: '金融' } },
      },
      objects: {
        lead: { fields: { industry: { options: { finance: '金融服务' } } } },
      },
    },
  };

  it('parses { label?, options: { value: label } }', () => {
    expect(TranslationDataSchema.safeParse(bundle['zh-CN']).success).toBe(true);
    expect(TranslationDataSchema.safeParse({ picklists: { industry: { options: { finance: '金融' } } } }).success).toBe(true);
  });

  it('a field that references the picklist inherits its option labels', () => {
    const served = translateObject({
      name: 'account',
      fields: {
        industry: { type: 'select', picklist: 'industry', options: INDUSTRY.options },
      },
    }, bundle, { locale: 'zh-CN' }) as { fields: Record<string, { options: Array<{ label: string }> }> };
    expect(served.fields.industry.options.map((o) => o.label)).toEqual(['科技', '金融']);
  });

  it('a field-level option label is the more specific and wins', () => {
    const served = translateObject({
      name: 'lead',
      fields: {
        industry: { type: 'select', picklist: 'industry', options: INDUSTRY.options },
      },
    }, bundle, { locale: 'zh-CN' }) as { fields: Record<string, { options: Array<{ label: string }> }> };
    expect(served.fields.industry.options.map((o) => o.label)).toEqual(['科技', '金融服务']);
  });

  it('an inline-options field does not read the picklist group', () => {
    const served = translateObject({
      name: 'account',
      fields: { industry: { type: 'select', options: INDUSTRY.options } },
    }, bundle, { locale: 'zh-CN' }) as { fields: Record<string, { options: Array<{ label: string }> }> };
    expect(served.fields.industry.options.map((o) => o.label)).toEqual(['Technology', 'Finance']);
  });

  it('a served picklist item translates its label and options, and is a translatable type', () => {
    const doc = translatePicklist(INDUSTRY, bundle, { locale: 'zh-CN' });
    expect(doc.label).toBe('行业');
    expect(doc.options.map((o) => o.label)).toEqual(['科技', '金融']);
    expect(TRANSLATABLE_METADATA_TYPES.has('picklist')).toBe(true);
  });
});
