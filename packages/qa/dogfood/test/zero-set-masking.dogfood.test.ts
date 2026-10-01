// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20995] A field whose masking rule applies used to be served MASKED to a
// caller who resolves no permission set, on a real boot — and [#21079] that
// caller, when it carries a principal, is now refused the object itself: the
// ADR-0056 D2 deny baseline, so no row, masked or stored, leaves the door.
//
// Two doors that produce that caller on a real composition are driven here:
//
//  - the public form's lookup picker, which hands the engine a context naming
//    the public-form profile, to a visitor with no session, on a deployment
//    that registers no such profile; and
//  - the record door, for a signed-in user on a deployment whose baseline is
//    switched off (`fallbackPermissionSet: null`) and who holds no grant.
//
// What is asserted, by class: the scene is real (a system read carries the
// stored value), and the door refuses at object admission (403,
// `PERMISSION_DENIED`) — the record door for the read and for a query alike.
// The masker's zero-set reading is still reached on a real boot through the
// public form submit's echo, pinned by `public-form-read-back-masking`.
//
// The picker-door case is shared with the card retiring the picker (#21180),
// which deletes that door; whichever of the two lands second adapts this file.
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST and
// auth layers. `@objectstack/plugin-security` resolves to its BUILT output
// here (no source alias), so build it before reading a verdict. Fixtures are
// synthetic.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { defineStack, defineView } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { SecurityPlugin } from '@objectstack/plugin-security';

const CONTACT = 'zsmask_contact';
const INQUIRY = 'zsmask_inquiry';
const KEY = 'zsmask_code';
/** Synthetic stored values. */
const STORED = 'SYNTH5150VALUE';
const NAME = 'Synthetic Contact';
const SYS = { context: { isSystem: true } } as const;

const ZsmaskContact = ObjectSchema.create({
  name: CONTACT,
  label: 'Zero-set Mask Contact',
  pluralLabel: 'Zero-set Mask Contacts',
  sharingModel: 'public_read_write',
  fields: {
    name: Field.text({ label: 'Name', required: true }),
    [KEY]: Field.text({ label: 'Code', maskingRule: { keepHead: 1, keepTail: 1 } }),
  },
});

const ZsmaskInquiry = ObjectSchema.create({
  name: INQUIRY,
  label: 'Zero-set Mask Inquiry',
  pluralLabel: 'Zero-set Mask Inquiries',
  sharingModel: 'public_read_write',
  fields: {
    subject: Field.text({ label: 'Subject', required: true }),
    contact: Field.lookup(CONTACT, { label: 'Contact' }),
  },
});

const data = { provider: 'object' as const, object: INQUIRY };
const ZsmaskInquiryViews = defineView({
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
            { field: 'contact', publicPicker: { displayFields: ['name', KEY] } },
          ],
        },
      ],
      sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/zsmask-intake' },
    },
  },
});

const zsmaskStack = defineStack({
  manifest: {
    id: 'com.dogfood.zero-set-mask',
    namespace: 'zsmask',
    version: '0.0.0',
    type: 'app',
    name: 'Zero-set Mask Fixture',
    description: 'One object with one masked field, and a public form whose picker displays it.',
  },
  objects: [ZsmaskContact, ZsmaskInquiry],
  views: [ZsmaskInquiryViews],
});

type Stack = Parameters<typeof bootStack>[0];

async function seedContact(stack: Awaited<ReturnType<typeof bootStack>>): Promise<string> {
  const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
  const row = await ql.insert(CONTACT, { name: NAME, [KEY]: STORED }, SYS);
  const id = String(row?.id ?? '');
  expect(id, 'fixture row seeded').toBeTruthy();
  const stored = await ql.findOne(CONTACT, { where: { id }, context: { isSystem: true } });
  expect(stored?.[KEY], 'the stored value is what a system read serves').toBe(STORED);
  return id;
}

/** [#21079] The door's answer to the deny baseline: refused at object admission, nothing served. */
async function expectRefusedAtAdmission(res: Response, what: string): Promise<void> {
  const text = await res.clone().text();
  expect(res.status, `${what}: ${text}`).toBe(403);
  const refusal = (await res.json()) as { code?: unknown; error?: { code?: unknown } };
  expect(refusal.code ?? refusal.error?.code, what).toBe('PERMISSION_DENIED');
  expect(text, `${what}: no stored value leaves the door`).not.toContain(STORED);
}

describe('[#20995] a caller who resolves no permission set, on a real boot: [#21079] refused at object admission', () => {
  it(
    'on the public form lookup door, to a visitor with no session, on a deployment without the public-form profile',
    async () => {
      const stack = await bootStack(zsmaskStack as unknown as Stack);
      try {
        await seedContact(stack);
        await expectRefusedAtAdmission(await stack.api('/forms/zsmask-intake/lookup/contact'), 'the picker');
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );

  it(
    'on the record door, to a signed-in user holding no grant on a deployment with no baseline',
    async () => {
      const stack = await bootStack(zsmaskStack as unknown as Stack, {
        security: new SecurityPlugin({ fallbackPermissionSet: null }),
      });
      try {
        const id = await seedContact(stack);
        const token = await stack.signUp('zsmask-nobody@verify.test');

        await expectRefusedAtAdmission(await stack.apiAs(token, 'GET', `/data/${CONTACT}/${id}`), 'the record read');
        // A query refused for naming the masked field would be the field
        // guard's answer; the one naming an unmasked field shows the object
        // itself is what is refused.
        await expectRefusedAtAdmission(
          await stack.apiAs(token, 'POST', `/data/${CONTACT}/query`, { where: { [KEY]: STORED } }),
          'a query naming the masked field',
        );
        await expectRefusedAtAdmission(
          await stack.apiAs(token, 'POST', `/data/${CONTACT}/query`, { where: { name: NAME } }),
          'a query naming an unmasked field',
        );
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
