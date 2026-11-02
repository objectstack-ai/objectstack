// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { cel } from '@objectstack/spec';

export const Contact = ObjectSchema.create({
  name: 'crm_contact',
  // [ADR-0090 D1] Explicit grandfather stamp: record isolation for this demo
  // object is intentionally org-shared; without this the new secure default
  // (unset OWD => private) would owner-filter it, and the D7 publish linter
  // (security-owd-unset) fails the build on an undeclared baseline.
  sharingModel: 'public_read_write',
  label: 'Contact',
  pluralLabel: 'Contacts',
  icon: 'user',
  description: 'A person associated with an account.',
  // The record's title is the person's full name. Without this pointer the
  // title is derived from the first name-ish field, which reads "Ada" on the
  // record page, in lookups and in pickers. A text formula is a display title:
  // search reaches the person through `last_name` and `email` instead.
  nameField: 'full_name',
  // What the record page shows at a glance, under the title.
  highlightFields: ['account', 'email'],

  fields: {
    first_name: Field.text({
      label: 'First Name',
      maxLength: 80,
    }),
    last_name: Field.text({
      label: 'Last Name',
      required: true,
      searchable: true,
      maxLength: 80,
    }),
    full_name: Field.formula({
      label: 'Full Name',
      // `text`, so the formula can back the record title (`nameField` above).
      returnType: 'text',
      expression: cel`(record.first_name == null ? '' : record.first_name + ' ') + record.last_name`,
    }),
    email: Field.email({
      label: 'Email',
      searchable: true,
    }),
    account: Field.lookup('crm_account', {
      label: 'Account',
    }),
  },
});
