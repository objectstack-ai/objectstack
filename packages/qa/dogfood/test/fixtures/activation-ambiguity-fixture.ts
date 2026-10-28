// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26572] The colliding scratch package `api-backend.action-activation-door-contract`
// names for its ambiguity arm (fixtures.knownGaps[0]): no stock app declares
// one action name on two objects, so the 409 RESOURCE_CONFLICT arm has no live
// door without it.
//
// Two objects each declare `actamb_archive` inside their own `actions`. The
// activation ledger addresses an action by its machine name alone (ADR-0126
// §4), so one row would switch both: the door must refuse, naming every
// owner, and write nothing.
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

/** The one machine name both objects declare. */
export const SHARED_ACTION = 'actamb_archive';
export const OWNERS = ['actamb_invoice', 'actamb_order'] as const;

const owner = (name: (typeof OWNERS)[number]) =>
  ObjectSchema.create({
    name,
    sharingModel: 'public_read_write',
    label: name === 'actamb_invoice' ? 'Invoice' : 'Order',
    pluralLabel: name === 'actamb_invoice' ? 'Invoices' : 'Orders',
    fields: { name: Field.text({ label: 'Name' }) },
    actions: [
      { name: SHARED_ACTION, label: 'Archive', objectName: name, type: 'script', operation: 'update', patch: { name: 'archived' } },
    ],
  } as any);

export const activationAmbiguityStack = defineStack({
  manifest: {
    id: 'com.dogfood.activation-ambiguity',
    namespace: 'actamb',
    version: '0.0.0',
    type: 'app',
    name: 'Activation Ambiguity Fixture',
    description: 'One action name declared on two objects.',
  },
  objects: OWNERS.map(owner),
} as any);
