// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A module package's translation bundle may carry only the navigation ids it
 * contributes into another package's app — no `apps.APP.label` (#27086).
 *
 * ## What was wrong
 *
 * A module contributes navigation into an app it does not own
 * (`manifest.navigationContributions`), and `translation-target-unknown`
 * accepts exactly the contributed ids under that app. The runtime deep-merges
 * every bundle per locale, so the owner's `apps.APP.label` survives. Yet
 * `apps.APP.label` was required, so a module bundle carrying only
 * `apps.<other app>.navigation.<contributed id>` failed `defineStack`,
 * `os validate` and `tsc` (TS2741, measured on main 72629f38). The only way
 * through was to restate the owner's label in every module pack.
 *
 * ## What is pinned
 *
 * - the module-only bundle type-checks as `TranslationData` / `TranslationBundle`
 *   (this file is compiled by the package's test type-check);
 * - `defineStack` (strict) accepts the module stack carrying it;
 * - the bare schema parse — the `os validate` door's — accepts it;
 * - CONTROL: a navigation entry still owes its own `label`, at both layers;
 * - CONTROL: an app entry that does author `label` keeps it.
 *
 * The `os validate` exit-code pin lives in
 * `packages/cli/test/translation-contributed-nav-validate-door.test.ts`, and the
 * runtime merge pin in `packages/services/service-i18n/src/file-i18n-adapter.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { defineStack, ObjectStackDefinitionSchema } from '../stack.zod';
import { TranslationDataSchema, type TranslationBundle, type TranslationData } from './translation.zod';

/** The module's zh-CN pack: the contributed id alone, no app label. */
const MODULE_ZH: TranslationData = {
  apps: { crm_enterprise: { navigation: { nav_case: { label: '工单' } } } },
};

const MODULE_BUNDLE: TranslationBundle = { 'zh-CN': MODULE_ZH };

/** A service module contributing one item into an app another package owns. */
const moduleStack = (translations: unknown[]) => ({
  manifest: {
    id: 'com.example.svc',
    name: 'Service module',
    namespace: 'svc',
    version: '1.0.0',
    type: 'module',
    engines: { protocol: '^18' },
    navigationContributions: [{
      app: 'crm_enterprise',
      items: [{ id: 'nav_case', type: 'object', objectName: 'svc_case', label: 'Cases' }],
    }],
  },
  objects: [{
    name: 'svc_case',
    label: 'Case',
    pluralLabel: 'Cases',
    sharingModel: 'private',
    fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
  }],
  i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'], fallbackLocale: 'en' },
  translations,
});

const parseIssues = (stack: unknown) => {
  const result = ObjectStackDefinitionSchema.safeParse(stack);
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
};

describe('a module bundle may translate only the navigation ids it contributes (#27086)', () => {
  it('defineStack accepts the module stack, the contributed label intact', () => {
    const stack = defineStack(moduleStack([MODULE_BUNDLE]) as Parameters<typeof defineStack>[0]);
    const zh = (stack.translations?.[0] as TranslationBundle)['zh-CN'];
    expect(zh.apps?.crm_enterprise).toEqual({ navigation: { nav_case: { label: '工单' } } });
  });

  it('the os validate parse accepts it', () => {
    expect(parseIssues(moduleStack([MODULE_BUNDLE]))).toEqual([]);
  });

  it('CONTROL: a navigation entry still owes its label, at the schema and at the type', () => {
    // @ts-expect-error — `navigation.<id>.label` is the leaf being translated; it stays required.
    const missing: TranslationData = { apps: { crm_enterprise: { navigation: { nav_case: {} } } } };
    expect(parseIssues(moduleStack([{ 'zh-CN': missing }]))).toEqual([
      'translations.0.zh-CN.apps.crm_enterprise.navigation.nav_case.label',
    ]);
  });

  it('CONTROL: an app entry that authors its label keeps it', () => {
    const owner = TranslationDataSchema.parse({
      apps: { crm_enterprise: { label: '企业 CRM', navigation: { nav_case: { label: '工单' } } } },
    });
    expect(owner.apps?.crm_enterprise?.label).toBe('企业 CRM');
  });
});
