// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20995] A field whose masking rule applies is served MASKED to a caller who
// resolves no permission set, on a real boot.
//
// `maskingRule` declares itself for "every non-system caller unless the
// field's `requiredPermissions` are ALL held". A caller who resolves no
// permission set holds nothing, so the rule applies to it. Two doors that
// produce that caller on a real composition are driven here:
//
//  - the public form's lookup picker, which serves the referenced object's
//    declared display fields to a visitor with no session, on a deployment
//    that registers no profile for public forms; and
//  - the record door, for a signed-in user on a deployment whose baseline is
//    switched off (`fallbackPermissionSet: null`) and who holds no grant.
//
// What is asserted, by class: the scene is real (a system read carries the
// stored value); the field is served masked, never stored; a field with no
// rule beside it is served as stored (the door really served the row); and,
// on the record door, a predicate on the masked field is refused.
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

function expectMasked(value: unknown): void {
  expect(typeof value, 'the masked field is served, as a string').toBe('string');
  expect(value).not.toBe(STORED);
  expect(String(value)).toContain('*');
  expect(String(value)).toHaveLength(STORED.length);
}

describe('[#20995] a masked field is served masked to a caller who resolves no permission set', () => {
  it(
    'on the public form lookup door, to a visitor with no session',
    async () => {
      const stack = await bootStack(zsmaskStack as unknown as Stack);
      try {
        await seedContact(stack);
        const res = await stack.api('/forms/zsmask-intake/lookup/contact');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: Array<Record<string, unknown>> };
        expect(body.data).toHaveLength(1);
        expect(body.data[0].name, 'the door served the row').toBe(NAME);
        expectMasked(body.data[0][KEY]);
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

        const res = await stack.apiAs(token, 'GET', `/data/${CONTACT}/${id}`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { record?: Record<string, unknown> };
        const record = body.record ?? (body as Record<string, unknown>);
        expect(record.name, 'the door served the row').toBe(NAME);
        expectMasked(record[KEY]);

        const probe = await stack.apiAs(token, 'POST', `/data/${CONTACT}/query`, { where: { [KEY]: STORED } });
        expect(probe.status).toBe(403);
        const refusal = (await probe.json()) as { code?: unknown; error?: { code?: unknown } };
        expect(refusal.code ?? refusal.error?.code).toBe('PERMISSION_DENIED');
      } finally {
        await stack.stop();
      }
    },
    120_000,
  );
});
