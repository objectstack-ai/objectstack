// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// FROZEN bare-literal fixtures for the remaining authoring domains (#2035), so
// the downstream contract exercises the FULL writable surface, not just a few
// domains. Authored the way a third party on a published release did, typed with
// the spec's own author-state aliases. DO NOT migrate these to the defineX
// factories and DO NOT edit them to make a failing spec change pass — see the
// README.
//
// The annotations moved from `XInput` to the BARE name in protocol 17
// (ADR-0122 phase 2, #6083) and that is not an exception to the freeze — it is
// the freeze working. These fixtures pin the AUTHOR state; phase 2 moved the
// author state onto the bare name and retired `XInput` as a synonym of it, so
// keeping `XInput` here was not an option and switching to it was not a choice.
// Every literal below is byte-for-byte what it was: the type each one is
// checked against did not change, only its spelling.
import type { Datasource, Mapping, Cube, ObjectExtension } from '@objectstack/spec/data';
import type { Connector } from '@objectstack/spec/integration';
import type { SharingRule, PermissionSet } from '@objectstack/spec/security';
import type { Position } from '@objectstack/spec/identity';
import type { EmailTemplateDefinition, TranslationBundle } from '@objectstack/spec/system';
import type { Webhook } from '@objectstack/spec/automation';

export const DcDatasource: Datasource = {
  name: 'dc_primary',
  label: 'DC Primary',
  driver: 'sqlite',
  config: { filename: ':memory:' },
  active: true,
};

export const DcConnector: Connector = {
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

export const DcSharingRule: SharingRule = {
  type: 'criteria',
  name: 'dc_share_customers',
  label: 'Customers → managers',
  object: 'dc_account',
  condition: 'record.stage == "customer"',
  accessLevel: 'read',
  sharedWith: { type: 'position', value: 'dc_manager' },
  active: true,
};

export const DcRole: Position = {
  name: 'dc_manager',
  label: 'DC Manager',
  description: 'Manager role.',
};

export const DcPermissionSet: PermissionSet = {
  name: 'dc_user',
  label: 'DC User',
  objects: {
    dc_account: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: false },
  },
};

export const DcEmail: EmailTemplateDefinition = {
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

export const DcWebhook: Webhook = {
  name: 'dc_account_changed',
  label: 'Account Changed',
  object: 'dc_account',
  triggers: ['create', 'update'],
  url: 'https://hooks.example.com/dc/account',
  method: 'POST',
  isActive: true,
};

export const DcObjectExtension: ObjectExtension = {
  extend: 'dc_account',
  label: 'Account (extended)',
  fields: {
    note: { name: 'note', label: 'Note', type: 'text', maxLength: 255 },
  },
  priority: 210,
};

export const DcCube: Cube = {
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

export const DcMapping: Mapping = {
  name: 'dc_csv_import',
  label: 'CSV Import: Accounts',
  sourceFormat: 'csv',
  targetObject: 'dc_account',
  mode: 'upsert',
  upsertKey: ['name'],
  fieldMapping: [{ source: 'Name', target: 'name', transform: 'none' }],
};

// `DcTheme` left with `ThemeSchema` (#10485, ADR-0049 — the theme authoring
// surface is retired; the freeze pins author state against a LIVE surface, and
// this one no longer exists).

export const DcTranslationBundle: TranslationBundle = {
  en: {
    objects: { dc_account: { label: 'Account', pluralLabel: 'Accounts' } },
    messages: { 'common.save': 'Save' },
  },
};
