// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21062] A public lookup picker whose FIRST display field declares a masking
// rule serves its rows, on a real boot, to a caller the rule applies to.
//
// The picker searches and sorts by one key. It is the first display field the
// caller may query on, by the security service's published answer
// (`getQueryableFields`), not blindly the first display field. A field whose
// masking rule applies to a caller is served to it masked and may not be
// searched or sorted on, so a picker keyed on it answered `403` to every such
// caller.
//
// What is asserted, by class, for a visitor with no session on a deployment
// that registers no profile for public forms: the scene is real (a system read
// carries the stored values); the rows are sorted on the next queryable display
// field, and the search matches it; the masked field is still served, masked;
// a signed-in caller reaching the same door is served the same (the door builds
// its own context); and a picker whose only display field is masked answers
// the engine's refusal, `403 PERMISSION_DENIED`.
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
const BY_NAME = ['Alpha Synthetic', 'Bravo Synthetic', 'Charlie Synthetic'];

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

function expectServedMasked(rows: Row[]): void {
  const stored = new Map(SEED.map((r) => [r.name, r[KEY]]));
  for (const row of rows) {
    const value = row[KEY];
    expect(typeof value, 'the masked field is served, as a string').toBe('string');
    expect(value).not.toBe(stored.get(String(row.name)));
    expect(String(value)).toContain('*');
  }
}

describe('[#21062] a public picker whose first display field is masked serves rows sorted on the next queryable one', () => {
  it(
    'to a visitor with no session and to a signed-in caller; a picker with no queryable display field is refused',
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
          const listed = await call('/forms/pqkey-intake/lookup/contact');
          expect(listed.status, who).toBe(200);
          const rows = ((await listed.json()) as { data: Row[] }).data;
          expect(rows.map((r) => r.name), `${who}: sorted on the next queryable display field`).toEqual(BY_NAME);
          expectServedMasked(rows);

          const searched = await call('/forms/pqkey-intake/lookup/contact?q=Charlie');
          expect(searched.status, who).toBe(200);
          const hits = ((await searched.json()) as { data: Row[] }).data;
          expect(hits.map((r) => r.name), `${who}: the search matches the next queryable display field`)
            .toEqual(['Charlie Synthetic']);
          expectServedMasked(hits);
        }

        const refused = await stack.api('/forms/pqkey-intake/lookup/contact_masked_only');
        expect(refused.status).toBe(403);
        const refusal = (await refused.json()) as { code?: unknown; error?: { code?: unknown } };
        expect(refusal.code ?? refusal.error?.code).toBe('PERMISSION_DENIED');
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
