// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// FROZEN bare-literal fixtures for the remaining authoring domains (#2035), so
// the downstream contract exercises the FULL writable surface, not just a few
// domains. Authored the way a third party on a published release did, typed with
// the spec's own input aliases. DO NOT migrate these to the defineX factories
// and DO NOT edit them to make a failing spec change pass — see the README.
import type { DatasourceInput, MappingInput, CubeInput, ObjectExtensionInput } from '@objectstack/spec/data';
import type { ConnectorInput } from '@objectstack/spec/integration';
import type { SharingRuleInput, PermissionSetInput } from '@objectstack/spec/security';
import type { PositionInput } from '@objectstack/spec/identity';
import type { EmailTemplateDefinitionInput, TranslationBundleInput } from '@objectstack/spec/system';
import type { WebhookInput } from '@objectstack/spec/automation';
import type { ThemeInput } from '@objectstack/spec/ui';

export const DcDatasource: DatasourceInput = {
  name: 'dc_primary',
  label: 'DC Primary',
  driver: 'sqlite',
  config: { filename: ':memory:' },
  active: true,
};

export const DcConnector: ConnectorInput = {
  name: 'dc_hubspot',
  label: 'DC HubSpot',
  type: 'saas',
  description: 'Example SaaS connector.',
  authentication: {
    type: 'oauth2',
    authorizationUrl: 'https://example.com/oauth/authorize',
    tokenUrl: 'https://example.com/oauth/token',
    clientId: 'env:DC_CLIENT_ID',
    clientSecret: 'env:DC_CLIENT_SECRET',
  },
  actions: [
    {
      key: 'create_contact',
      label: 'Create Contact',
      description: 'Create a contact',
      inputSchema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
    },
  ],
};

export const DcSharingRule: SharingRuleInput = {
  type: 'criteria',
  name: 'dc_share_customers',
  label: 'Customers → managers',
  object: 'dc_account',
  condition: 'record.stage == "customer"',
  accessLevel: 'read',
  sharedWith: { type: 'position', value: 'dc_manager' },
  active: true,
};

export const DcRole: PositionInput = {
  name: 'dc_manager',
  label: 'DC Manager',
  description: 'Manager role.',
};

export const DcPermissionSet: PermissionSetInput = {
  name: 'dc_user',
  label: 'DC User',
  objects: {
    dc_account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
  },
};

export const DcEmail: EmailTemplateDefinitionInput = {
  name: 'dc.welcome',
  label: 'DC Welcome',
  category: 'marketing',
  locale: 'en-US',
  subject: 'Welcome {{contact.first_name}}',
  bodyHtml: '<p>Hi {{contact.first_name}}, welcome.</p>',
  bodyText: 'Hi {{contact.first_name}}, welcome.',
  variables: [{ name: 'contact.first_name', type: 'string', required: true }],
  active: true,
};

export const DcWebhook: WebhookInput = {
  name: 'dc_account_changed',
  label: 'Account Changed',
  object: 'dc_account',
  triggers: ['create', 'update'],
  url: 'https://hooks.example.com/dc/account',
  method: 'POST',
  isActive: true,
};

export const DcObjectExtension: ObjectExtensionInput = {
  extend: 'dc_account',
  label: 'Account (extended)',
  fields: {
    note: { name: 'note', label: 'Note', type: 'text', maxLength: 255 },
  },
  priority: 210,
};

export const DcCube: CubeInput = {
  name: 'dc_pipeline',
  title: 'DC Pipeline',
  description: 'Account analytics.',
  sql: 'dc_account',
  measures: {
    count: { name: 'count', label: 'Count', type: 'count', sql: '*' },
  },
  dimensions: {
    stage: { name: 'stage', label: 'Stage', type: 'string', sql: 'stage' },
  },
};

export const DcMapping: MappingInput = {
  name: 'dc_csv_import',
  label: 'CSV Import: Accounts',
  sourceFormat: 'csv',
  targetObject: 'dc_account',
  mode: 'upsert',
  upsertKey: ['name'],
  fieldMapping: [{ source: 'Name', target: 'name', transform: 'none' }],
};

export const DcTheme: ThemeInput = {
  name: 'dc_light',
  label: 'DC Light',
  mode: 'light',
  colors: {
    primary: '#1E6FD9',
    secondary: '#6C757D',
    background: '#FFFFFF',
    surface: '#F8F9FA',
    text: '#212529',
  },
};

export const DcTranslationBundle: TranslationBundleInput = {
  en: {
    objects: { dc_account: { label: 'Account', pluralLabel: 'Accounts' } },
    messages: { 'common.save': 'Save' },
  },
};
