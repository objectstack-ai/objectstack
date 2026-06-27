// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ActionSchema, ReportSchema, PageSchema, ThemeSchema } from '@objectstack/spec/ui';
import { DatasourceSchema, MappingSchema, CubeSchema, ObjectExtensionSchema } from '@objectstack/spec/data';
import { ConnectorSchema } from '@objectstack/spec/integration';
import { SharingRuleSchema, PermissionSetSchema } from '@objectstack/spec/security';
import { RoleSchema } from '@objectstack/spec/identity';
import { EmailTemplateDefinitionSchema, TranslationBundleSchema } from '@objectstack/spec/system';
import { WebhookSchema } from '@objectstack/spec/automation';
import { LogCallAction } from '../src/log-call.action.js';
import { AccountsByStageReport } from '../src/pipeline.report.js';
import { WelcomePage } from '../src/welcome.page.js';
import { ContractStack } from '../src/stack.js';
import * as more from '../src/additional-domains.fixtures.js';

// FROZEN — see README. A failure means a spec change dropped or narrowed a
// property a published-spec third party already uses. That is breaking: adjust
// the spec or bump major; do NOT edit the fixtures to make this pass.
describe('downstream consumer contract (#2035)', () => {
  it('bare-literal third-party metadata still parses against the current spec', () => {
    expect(() => ActionSchema.parse(LogCallAction)).not.toThrow();
    expect(() => ReportSchema.parse(AccountsByStageReport)).not.toThrow();
    expect(() => PageSchema.parse(WelcomePage)).not.toThrow();
  });

  it('assembles into a stack — schema + cross-reference validation passes', () => {
    expect(ContractStack).toBeDefined();
    expect(ContractStack.objects).toHaveLength(1);
    expect(ContractStack.actions).toHaveLength(2);
  });

  // Full writable-surface coverage: one frozen bare-literal per remaining domain
  // (#2035). A narrowed/removed schema property on ANY of these breaks here.
  const cases: Array<[string, { parse: (v: unknown) => unknown }, unknown]> = [
    ['Datasource', DatasourceSchema, more.DcDatasource],
    ['Connector', ConnectorSchema, more.DcConnector],
    ['SharingRule', SharingRuleSchema, more.DcSharingRule],
    ['Role', RoleSchema, more.DcRole],
    ['PermissionSet', PermissionSetSchema, more.DcPermissionSet],
    ['EmailTemplateDefinition', EmailTemplateDefinitionSchema, more.DcEmail],
    ['Webhook', WebhookSchema, more.DcWebhook],
    ['ObjectExtension', ObjectExtensionSchema, more.DcObjectExtension],
    ['Cube', CubeSchema, more.DcCube],
    ['Mapping', MappingSchema, more.DcMapping],
    ['Theme', ThemeSchema, more.DcTheme],
    ['TranslationBundle', TranslationBundleSchema, more.DcTranslationBundle],
  ];

  it.each(cases)('%s bare-literal parses against the current spec', (_name, schema, fixture) => {
    expect(() => schema.parse(fixture)).not.toThrow();
  });
});
