// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21062] A public lookup picker whose FIRST display field declares a masking
// rule served its rows, on a real boot, to a caller the rule applies to.
//
// The picker searches and sorts by one key. It is the first display field the
// caller may query on, by the security service's published answer
// (`getQueryableFields`), not blindly the first display field. A field whose
// masking rule applies to a caller is served to it masked and may not be
// searched or sorted on, so a picker keyed on it answered `403` to every such
// caller.
//
// [#21079] On a deployment that registers no profile for public forms, the
// picker's context resolves NO permission set, and an empty set list is the
// ADR-0056 D2 deny baseline: the engine refuses that caller at object
// admission, before any field guard. So on this fixture every picker answers
// `403 PERMISSION_DENIED` and serves nothing — the key it composes is unchanged
// (the unit pin `public-form-lookup-picker-queryable-key.test.ts` holds that),
// but no row leaves the door. The picker is retired on its own card; until
// then this is what it answers here.
//
// What is asserted, by class, for a visitor with no session on that
// deployment: the scene is real (a system read carries the stored values); the
// listing and the search are both refused at object admission, with no stored
// value in the answer; a signed-in caller reaching the same door is refused the
// same (the door builds its own context); and a picker whose only display field
// is masked is refused with the same code and status.
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST and
// auth layers. `@objectstack/rest` resolves to its BUILT output here (no source
// alias), so build it before reading a verdict. Fixtures are synthetic.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { defineStack, defineView } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

const CONTACT = 'pqkey_contact';
const INQUIRY = 'pqkey_inquiry';
const KEY = 'pqkey_code';
const SYS = { context: { isSystem: true } } as const;

/** Synthetic rows whose order by name and by the masked field differ. */
const SEED = [
  { name: 'Bravo Synthetic', [KEY]: 'SYNTH1AAA' },
  { name: 'Alpha Synthetic', [KEY]: 'SYNTH3CCC' },
  { name: 'Charlie Synthetic', [KEY]: 'SYNTH2BBB' },
];

const PqkeyContact = ObjectSchema.create({
  name: CONTACT,
  label: 'Picker Key Contact',
  pluralLabel: 'Picker Key Contacts',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    [KEY]: Field.text({ label: 'Code', maskingRule: { keepHead: 1, keepTail: 1 } }),
  },
});

const PqkeyInquiry = ObjectSchema.create({
  name: INQUIRY,
  label: 'Picker Key Inquiry',
  pluralLabel: 'Picker Key Inquiries',
  sharingModel: 'public_read_write',
  fields: {
    subject: Field.text({ label: 'Subject', required: true }),
    contact: Field.lookup(CONTACT, { label: 'Contact' }),
    contact_masked_only: Field.lookup(CONTACT, { label: 'Contact (masked only)' }),
  },
});

const data = { provider: 'object' as const, object: INQUIRY };
const PqkeyInquiryViews = defineView({
  list: { label: 'Inquiries', type: 'grid', data, columns: [{ field: 'subject' }] },
  formViews: {
    intake: {
      type: 'simple',
      data,
      sections: [
        {
          name: 'intake',
          label: 'Intake',
          columns: 1,
          fields: [
            { field: 'subject', required: true },
            { field: 'contact', publicPicker: { displayFields: [KEY, 'name'] } },
            { field: 'contact_masked_only', publicPicker: { displayFields: [KEY] } },
          ],
        },
      ],
      sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/pqkey-intake' },
    },
  },
});

const pqkeyStack = defineStack({
  manifest: {
    id: 'com.dogfood.picker-queryable-key',
    namespace: 'pqkey',
    version: '0.0.0',
    type: 'app',
    name: 'Picker Queryable Key Fixture',
    description: 'One object with a masked field, and a public form whose picker displays it first.',
  },
  objects: [PqkeyContact, PqkeyInquiry],
  views: [PqkeyInquiryViews],
});

type Stack = Parameters<typeof bootStack>[0];
type Row = Record<string, unknown>;

/** [#21079] The deny baseline's answer at the door: refused at object admission, nothing served. */
async function expectRefusedAtAdmission(res: Response, what: string): Promise<void> {
  const text = await res.clone().text();
  expect(res.status, `${what}: ${text}`).toBe(403);
  const refusal = (await res.json()) as { code?: unknown; error?: { code?: unknown }; data?: unknown };
  expect(refusal.code ?? refusal.error?.code, what).toBe('PERMISSION_DENIED');
  expect(refusal.data, `${what}: no row is served`).toBeUndefined();
  for (const row of SEED) expect(text, `${what}: no stored value leaves the door`).not.toContain(String(row[KEY]));
}

describe('[#21062] a public picker whose first display field is masked: [#21079] refused at object admission on a deployment without the public-form profile', () => {
  it(
    'to a visitor with no session and to a signed-in caller; a picker with no queryable display field is refused the same',
    async () => {
      const stack = await bootStack(pqkeyStack as unknown as Stack);
      try {
        const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
        for (const row of SEED) await ql.insert(CONTACT, { ...row }, SYS);
        const stored = await ql.find(CONTACT, { where: {}, context: { isSystem: true } });
        expect(stored.map((r: Row) => r[KEY]).sort(), 'the stored values are what a system read serves')
          .toEqual(SEED.map((r) => r[KEY]).sort());

        const token = await stack.signUp('pqkey-member@verify.test');
        for (const [who, call] of [
          ['a visitor with no session', (path: string) => stack.api(path)],
          ['a signed-in caller', (path: string) => stack.apiAs(token, 'GET', path)],
        ] as const) {
          await expectRefusedAtAdmission(await call('/forms/pqkey-intake/lookup/contact'), `${who}: the listing`);
          await expectRefusedAtAdmission(await call('/forms/pqkey-intake/lookup/contact?q=Charlie'), `${who}: the search`);
        }

        await expectRefusedAtAdmission(
          await stack.api('/forms/pqkey-intake/lookup/contact_masked_only'),
          'a picker with no queryable display field',
        );
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
