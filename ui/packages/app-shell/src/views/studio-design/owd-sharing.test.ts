// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { OWD_MODELS, cbpMasterRefusal, deriveMasterObject, requireCbpMasterDetails } from './owd-sharing';

describe('owd-sharing — canonical values (ADR-0090 D4)', () => {
  it('offers exactly the four canonical models', () => {
    expect([...OWD_MODELS]).toEqual([
      'private',
      'public_read',
      'public_read_write',
      'controlled_by_parent',
    ]);
  });
});

describe('owd-sharing — deriveMasterObject', () => {
  it('reads the required master-detail reference from a keyed-map fields shape', () => {
    const fields = {
      name: { type: 'text' },
      account: { type: 'master_detail', reference: 'crm_account', required: true },
    };
    expect(deriveMasterObject(fields)).toBe('crm_account');
  });

  it('reads it from an array fields shape', () => {
    const fields = [
      { name: 'name', type: 'text' },
      { name: 'parent', type: 'master_detail', reference: 'crm_case', required: true },
    ];
    expect(deriveMasterObject(fields)).toBe('crm_case');
  });

  it('returns undefined when there is no master-detail field', () => {
    expect(deriveMasterObject({ name: { type: 'text' } })).toBeUndefined();
    expect(deriveMasterObject(undefined)).toBeUndefined();
    // A master-detail field without a reference target resolves to undefined.
    expect(deriveMasterObject({ p: { type: 'master_detail', required: true } })).toBeUndefined();
  });
});

/**
 * objectui#12326 — the display reader agrees with the runtime (ADR-0055 §1,
 * objectstack#23100): the ONE `master_detail` declared `required: true` names
 * the master, and any other shape names none. The installed spec's
 * `ObjectSchema` is the oracle for which shapes the platform accepts: every
 * shape this reader names a master for parses as a `controlled_by_parent`
 * object, and every shape it names none for is refused.
 */
describe('owd-sharing — deriveMasterObject agrees with the runtime (objectui#12326)', () => {
  const asCbp = (fields: Record<string, unknown>) =>
    ObjectSchema.safeParse({ name: 'crm_case', sharingModel: 'controlled_by_parent', fields }).success;

  const SHAPES: Array<[string, Record<string, unknown>, string | undefined]> = [
    ['one required master', { account: { type: 'master_detail', reference: 'crm_account', required: true } }, 'crm_account'],
    ['one master without required', { account: { type: 'master_detail', reference: 'crm_account' } }, undefined],
    [
      'two required masters',
      {
        account: { type: 'master_detail', reference: 'crm_account', required: true },
        contact: { type: 'master_detail', reference: 'crm_contact', required: true },
      },
      undefined,
    ],
    [
      'a non-required master before the required one',
      {
        contact: { type: 'master_detail', reference: 'crm_contact' },
        account: { type: 'master_detail', reference: 'crm_account', required: true },
      },
      'crm_account',
    ],
    ['a required lookup only', { account: { type: 'lookup', reference: 'crm_account', required: true } }, undefined],
    ['no relationship field', { subject: { type: 'text' } }, undefined],
  ];

  it.each(SHAPES)('%s', (_label, fields, master) => {
    expect(deriveMasterObject(fields)).toBe(master);
    expect(asCbp(fields)).toBe(master !== undefined);
  });
});

describe('owd-sharing — requireCbpMasterDetails (objectui#12326)', () => {
  it('sets required: true on a master-detail field that omits it, keeping the record shape', () => {
    const fields = {
      subject: { type: 'text', label: 'Subject' },
      account: { type: 'master_detail', label: 'Account', reference: 'crm_account' },
    };
    const next = requireCbpMasterDetails(fields) as Record<string, Record<string, unknown>>;
    expect(next).toEqual({
      subject: { type: 'text', label: 'Subject' },
      account: { type: 'master_detail', label: 'Account', reference: 'crm_account', required: true },
    });
    expect(
      ObjectSchema.safeParse({ name: 'crm_case', sharingModel: 'controlled_by_parent', fields: next }).success,
    ).toBe(true);
  });

  it('keeps the array shape', () => {
    const next = requireCbpMasterDetails([{ name: 'parent', type: 'master_detail', reference: 'crm_case' }]);
    expect(next).toEqual([{ name: 'parent', type: 'master_detail', reference: 'crm_case', required: true }]);
  });

  it('returns the input itself when every master-detail field is already required', () => {
    const fields = { account: { type: 'master_detail', reference: 'crm_account', required: true } };
    expect(requireCbpMasterDetails(fields)).toBe(fields);
    const none = { subject: { type: 'text' } };
    expect(requireCbpMasterDetails(none)).toBe(none);
  });

  it('never picks a master: with two master-detail fields both become required, and the spec refuses that', () => {
    const next = requireCbpMasterDetails({
      account: { type: 'master_detail', reference: 'crm_account' },
      contact: { type: 'master_detail', reference: 'crm_contact' },
    }) as Record<string, Record<string, unknown>>;
    expect(next.account.required).toBe(true);
    expect(next.contact.required).toBe(true);
    expect(deriveMasterObject(next)).toBeUndefined();
  });
});

describe('owd-sharing — cbpMasterRefusal reports the installed spec\'s refusal (objectui#12326)', () => {
  /** The refusal the spec gives the WHOLE object, at the two paths its master check reports at. */
  const specRefusal = (fields: Record<string, unknown>): string | undefined => {
    const r = ObjectSchema.safeParse({ name: 'crm_case', sharingModel: 'controlled_by_parent', fields });
    if (r.success) return undefined;
    const issue = r.error.issues.find(
      (i) => i.code === 'custom' && i.path.length === 1 && ['sharingModel', 'fields'].includes(String(i.path[0])),
    );
    return issue?.message;
  };

  const CASES: Array<[string, Record<string, unknown>]> = [
    ['one required master', { account: { type: 'master_detail', reference: 'crm_account', required: true } }],
    ['one master without required', { account: { type: 'master_detail', reference: 'crm_account' } }],
    [
      'two required masters',
      {
        account: { type: 'master_detail', reference: 'crm_account', required: true },
        contact: { type: 'master_detail', reference: 'crm_contact', required: true },
      },
    ],
    ['a required lookup only', { account: { type: 'lookup', reference: 'crm_account', required: true } }],
    ['no relationship field', { subject: { type: 'text', label: 'Subject' } }],
  ];

  it.each(CASES)('%s: the same verdict and the same text as the spec', (_label, fields) => {
    expect(cbpMasterRefusal('crm_case', fields)).toBe(specRefusal(fields));
  });

  it('still reports the refusal when another part of the draft would stop the spec first', () => {
    const fields = {
      account: { type: 'master_detail', reference: 'crm_account' },
      // An unknown key on another field: a parse of the whole draft stops at it
      // and never reaches the master check.
      subject: { type: 'text', bogus_key: 1 },
    };
    expect(specRefusal(fields)).toBeUndefined();
    expect(cbpMasterRefusal('crm_case', fields)).toBe(
      specRefusal({ account: { type: 'master_detail', reference: 'crm_account' } }),
    );
  });

  it('accepts the array fields shape', () => {
    expect(cbpMasterRefusal('crm_case', [{ name: 'account', type: 'master_detail', reference: 'crm_account' }])).toBe(
      specRefusal({ account: { type: 'master_detail', reference: 'crm_account' } }),
    );
  });
});
