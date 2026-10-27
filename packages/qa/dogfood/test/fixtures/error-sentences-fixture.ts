// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26572] The scratch app `api-backend.error-sentences-and-unique-violation-wire-code`
// names for its live legs, as a fixture: the checklist item asks for planted
// metadata on a scratch copy, never on the shared showcase.
//
//  - `errsent_budget` carries a `beforeInsert` hook whose sandboxed body throws
//    a business sentence, and declares no `code`: the /data write doors must
//    answer 400 with that sentence verbatim.
//  - `errsent_contact` carries a `unique: true` email and a declarative
//    `operation: 'update'` action whose patch writes the email another row
//    already holds: the action door must answer the engine's duplicate as
//    409 UNIQUE_VIOLATION.
//
// Both objects declare a sharingModel (`security-owd-unset` refuses compile
// otherwise) and sit wide open: the refusals under test are a hook's and the
// store's, never a sharing gate's.
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { PermissionSetSchema, type PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';

/** The sentence the hook throws; a refusal that carries it was answered in the hook's own words. */
export const HOOK_SENTENCE = 'A budget line needs an approver before it can be recorded.';

/** The email the first contact holds; the action writes it onto a second contact. */
export const TAKEN_EMAIL = 'taken.26572@errsent.test';

export const ErrsentBudget = ObjectSchema.create({
  name: 'errsent_budget',
  sharingModel: 'public_read_write',
  label: 'Budget line',
  pluralLabel: 'Budget lines',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    amount: Field.number({ label: 'Amount' }),
  },
});

export const ErrsentContact = ObjectSchema.create({
  name: 'errsent_contact',
  sharingModel: 'public_read_write',
  label: 'Contact',
  pluralLabel: 'Contacts',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    email: Field.text({ label: 'Email', unique: true }),
  },
});

export const errorSentencesStack = defineStack({
  manifest: {
    id: 'com.dogfood.error-sentences',
    namespace: 'errsent',
    version: '0.0.0',
    type: 'app',
    name: 'Error Sentences Fixture',
    description: 'A hook that refuses in its own words, and an action that repeats a unique value.',
  },
  objects: [ErrsentBudget, ErrsentContact],
  actions: [
    {
      name: 'errsent_take_email',
      label: 'Take the taken email',
      objectName: 'errsent_contact',
      type: 'script',
      operation: 'update',
      patch: { email: TAKEN_EMAIL },
      execution: 'perRecord',
    },
  ],
  hooks: [
    {
      name: 'errsent_budget_needs_approver',
      label: 'Refuse a budget line without an approver',
      object: 'errsent_budget',
      events: ['beforeInsert'],
      body: { language: 'js', source: `throw new Error(${JSON.stringify(HOOK_SENTENCE)});` },
    },
  ],
} as any);

const crud = { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true };

export const errsentMemberSet: PermissionSet = PermissionSetSchema.parse({
  name: 'errsent_fixture_member',
  label: 'Error sentences fixture member',
  objects: { errsent_budget: crud, errsent_contact: crud },
});

export function errorSentencesSecurity(): SecurityPlugin {
  return new SecurityPlugin({
    defaultPermissionSets: [...securityDefaultPermissionSets, errsentMemberSet],
    fallbackPermissionSet: errsentMemberSet.name,
  });
}
