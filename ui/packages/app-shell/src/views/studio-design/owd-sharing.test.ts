// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { CONTROLLED_BY_PARENT_MASTER_INVALID, ObjectSchema } from '@objectstack/spec/data';
import { CBP_REFUSAL_KEYS, OWD_MODELS, cbpMasterRefusal, deriveMasterObject, requireCbpMasterDetails } from './owd-sharing';

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
 * objectstack#23100): the master is the one the spec's
 * `controlledByParentMasterOf` names, and any other shape names none. The
 * installed spec's `ObjectSchema` is the oracle for which shapes the platform
 * accepts: every shape this reader names a master for parses as a
 * `controlled_by_parent` object, and every shape it names none for is refused.
 *
 * ADR-0055 §1 as amended (objectstack#30905 ruling A) adds an OPTIONAL master:
 * an object's only `master_detail` declared `required: false`, which this
 * reader names (objectstack#30974). An omitted `required` on that only
 * `master_detail` is the master too: the parse admits it, and Studio, the
 * builder and stored data read it as required.
 */
describe('owd-sharing — deriveMasterObject agrees with the runtime (objectui#12326)', () => {
  const asCbp = (fields: Record<string, unknown>) =>
    ObjectSchema.safeParse({ name: 'crm_case', sharingModel: 'controlled_by_parent', fields }).success;

  // [label, fields, the master named]
  const SHAPES: Array<[string, Record<string, unknown>, string | undefined]> = [
    ['one required master', { account: { type: 'master_detail', reference: 'crm_account', required: true } }, 'crm_account'],
    ['one master without required', { account: { type: 'master_detail', reference: 'crm_account' } }, 'crm_account'],
    [
      'one optional master (required: false)',
      { account: { type: 'master_detail', reference: 'crm_account', required: false } },
      'crm_account',
    ],
    [
      'a master-detail declared required: false beside the required one',
      {
        contact: { type: 'master_detail', reference: 'crm_contact', required: false },
        account: { type: 'master_detail', reference: 'crm_account', required: true },
      },
      'crm_account',
    ],
    [
      'two master-detail fields, none required',
      {
        account: { type: 'master_detail', reference: 'crm_account', required: false },
        contact: { type: 'master_detail', reference: 'crm_contact', required: false },
      },
      undefined,
    ],
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

  it('keeps an optional master: an explicit required: false is never turned required (objectstack#30974)', () => {
    const fields = { account: { type: 'master_detail', reference: 'crm_account', required: false } };
    expect(requireCbpMasterDetails(fields)).toBe(fields);
    const arr = [{ name: 'parent', type: 'master_detail', reference: 'crm_case', required: false }];
    expect(requireCbpMasterDetails(arr)).toBe(arr);
    const mixed = requireCbpMasterDetails({
      account: { type: 'master_detail', reference: 'crm_account', required: false },
      contact: { type: 'master_detail', reference: 'crm_contact' },
    }) as Record<string, Record<string, unknown>>;
    expect(mixed.account.required).toBe(false);
    expect(mixed.contact.required).toBe(true);
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
    ['a required master marked readonly', { account: { type: 'master_detail', reference: 'crm_account', required: true, readonly: true } }],
    ['an optional master marked system', { account: { type: 'master_detail', reference: 'crm_account', required: false, system: true } }],
  ];

  it.each(CASES)('%s: the same verdict and the same text as the spec', (_label, fields) => {
    expect(cbpMasterRefusal('crm_case', fields)?.message).toBe(specRefusal(fields));
  });

  it('still reports the refusal when another part of the draft would stop the spec first', () => {
    const fields = {
      account: { type: 'master_detail', reference: 'crm_account' },
      // An unknown key on another field: a parse of the whole draft stops at it
      // and never reaches the master check.
      subject: { type: 'text', bogus_key: 1 },
    };
    expect(specRefusal(fields)).toBeUndefined();
    expect(cbpMasterRefusal('crm_case', fields)?.message).toBe(
      specRefusal({ account: { type: 'master_detail', reference: 'crm_account' } }),
    );
  });

  it('accepts the array fields shape', () => {
    expect(cbpMasterRefusal('crm_case', [{ name: 'account', type: 'master_detail', reference: 'crm_account' }])?.message).toBe(
      specRefusal({ account: { type: 'master_detail', reference: 'crm_account' } }),
    );
  });
});

describe('owd-sharing — cbpMasterRefusal reads the spec\'s code and shape off the issue (objectstack#36526)', () => {
  const names = (r: ReturnType<typeof cbpMasterRefusal>) => r?.fields.map((e) => e.name);

  it('two required masters: shape several-required-masters, naming both', () => {
    const r = cbpMasterRefusal('crm_case', {
      account: { type: 'master_detail', reference: 'crm_account', required: true },
      subject: { type: 'text' },
      contact: { type: 'master_detail', reference: 'crm_contact', required: true },
    });
    expect(r?.shape).toBe('several-required-masters');
    expect(names(r)).toEqual(['account', 'contact']);
  });

  it('two master-detail fields, none required: shape several-masters, naming both', () => {
    const r = cbpMasterRefusal('crm_case', {
      account: { type: 'master_detail', reference: 'crm_account', required: false },
      contact: { type: 'master_detail', reference: 'crm_contact', required: false },
    });
    expect(r?.shape).toBe('several-masters');
    expect(names(r)).toEqual(['account', 'contact']);
  });

  it('a required lookup only: shape required-lookup-only, naming the required lookups and no optional one', () => {
    const r = cbpMasterRefusal('crm_case', {
      account: { type: 'lookup', reference: 'crm_account', required: true },
      owner: { type: 'lookup', reference: 'sys_user' },
    });
    expect(r?.shape).toBe('required-lookup-only');
    expect(names(r)).toEqual(['account']);
  });

  it('a master marked readonly or system: shape master-not-writable, naming the master', () => {
    for (const flag of ['readonly', 'system'] as const) {
      const r = cbpMasterRefusal('crm_case', {
        account: { type: 'master_detail', reference: 'crm_account', required: true, [flag]: true },
        owner: { type: 'lookup', reference: 'sys_user', [flag]: true },
      });
      expect(r?.shape, flag).toBe('master-not-writable');
      expect(names(r), flag).toEqual(['account']);
    }
    // A master that writes no `required`: the parse defaults it to `false` and
    // judges it the optional master, so the refusal still names it.
    for (const flag of ['readonly', 'system'] as const) {
      const r = cbpMasterRefusal('crm_case', { account: { type: 'master_detail', reference: 'crm_account', [flag]: true } });
      expect(r?.shape, `omitted required, ${flag}`).toBe('master-not-writable');
      expect(names(r), `omitted required, ${flag}`).toEqual(['account']);
    }
    // `false` is no refusal: the flag is carried as written, not as present.
    expect(cbpMasterRefusal('crm_case', {
      account: { type: 'master_detail', reference: 'crm_account', required: true, readonly: false, system: false },
    })).toBeUndefined();
  });

  it('no relationship field: shape no-master, naming nothing', () => {
    const r = cbpMasterRefusal('crm_case', { subject: { type: 'text' } });
    expect(r?.shape).toBe('no-master');
    expect(names(r)).toEqual([]);
  });

  it('the shape is the one the spec stamped beside its code on the save door\'s parse', () => {
    const fields = { subject: { type: 'text' } };
    const parsed = ObjectSchema.safeParse({ name: 'crm_case', sharingModel: 'controlled_by_parent', fields });
    const issue = parsed.success ? undefined : parsed.error.issues.find((i) => i.path.join('.') === 'sharingModel');
    expect((issue as { params?: unknown } | undefined)?.params).toEqual({
      code: CONTROLLED_BY_PARENT_MASTER_INVALID,
      shape: cbpMasterRefusal('crm_case', fields)?.shape,
    });
  });

  it('every spec shape has a wording row', () => {
    expect(Object.keys(CBP_REFUSAL_KEYS).sort()).toEqual([
      'master-not-required',
      'master-not-writable',
      'no-master',
      'required-lookup-only',
      'several-masters',
      'several-required-masters',
    ]);
  });
});
