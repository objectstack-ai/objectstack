// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Flow screen record-link fixture (#25872, contract half #26304).
//
// The shape the ruling asks for: a screen flow that creates records ends on a
// result screen that links them, instead of a toast that points at nothing.
// The flow asks for a company and a contact, writes an account and a contact,
// and pauses on a last screen of two read-only `type: 'record_link'` fields
// whose `defaultValue` envelopes read the created records' ids.
//
// Both objects name their records by a field that is NOT `name`
// (`company_name`, `full_name`, ADR-0079 `nameField`), so a client that showed
// a `name` column or the raw id would show the wrong thing.

import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import type { Flow } from '@objectstack/spec/automation';

export const SrlAccount = ObjectSchema.create({
  name: 'srl_account',
  // [ADR-0090 D1] grandfather stamp: the gate under test is the result screen,
  // not owner-sharing.
  sharingModel: 'public_read_write',
  label: 'Account',
  pluralLabel: 'Accounts',
  nameField: 'company_name',
  fields: {
    company_name: Field.text({ label: 'Company', required: true }),
  },
});

export const SrlContact = ObjectSchema.create({
  name: 'srl_contact',
  sharingModel: 'public_read_write',
  label: 'Contact',
  pluralLabel: 'Contacts',
  nameField: 'full_name',
  fields: {
    full_name: Field.text({ label: 'Full name', required: true }),
    account: Field.lookup('srl_account', { label: 'Account' }),
  },
});

const CEL = (source: string) => ({ dialect: 'cel' as const, source });

/**
 * `srl_convert` — start → ask (company, contact) → create account → create
 * contact → result (two record links) → end.
 */
export const flowScreenRecordLink: Flow = {
  name: 'srl_convert',
  label: 'Convert with a result screen',
  type: 'screen',
  status: 'active',
  runAs: 'user',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    {
      id: 'ask',
      type: 'screen',
      label: 'Convert',
      config: {
        title: 'Convert',
        fields: [
          { name: 'company', label: 'Company', type: 'text', required: true },
          { name: 'contact_name', label: 'Contact', type: 'text', required: true },
        ],
      },
    },
    {
      id: 'create_account',
      type: 'create_record',
      label: 'Create account',
      config: { objectName: 'srl_account', fields: { company_name: CEL('company') }, outputVariable: 'account' },
    },
    {
      id: 'create_contact',
      type: 'create_record',
      label: 'Create contact',
      config: {
        objectName: 'srl_contact',
        fields: { full_name: CEL('contact_name'), account: CEL('account.id') },
        outputVariable: 'contact',
      },
    },
    {
      id: 'result',
      type: 'screen',
      label: 'Created',
      config: {
        title: 'Created',
        fields: [
          { name: 'account_link', label: 'Account', type: 'record_link', reference: 'srl_account', defaultValue: CEL('account.id') },
          { name: 'contact_link', label: 'Contact', type: 'record_link', reference: 'srl_contact', defaultValue: CEL('contact.id') },
        ],
      },
    },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'ask' },
    { id: 'e2', source: 'ask', target: 'create_account' },
    { id: 'e3', source: 'create_account', target: 'create_contact' },
    { id: 'e4', source: 'create_contact', target: 'result' },
    { id: 'e5', source: 'result', target: 'end' },
  ],
};

export const screenRecordLinkStack = defineStack({
  manifest: {
    id: 'com.dogfood.flow-screen-record-link',
    namespace: 'srl',
    version: '0.0.0',
    type: 'app',
    name: 'Flow Screen Record Link Fixture',
    description: 'A screen flow that creates two records and ends on a screen that links them.',
  },
  objects: [SrlAccount, SrlContact],
  flows: [flowScreenRecordLink],
});
