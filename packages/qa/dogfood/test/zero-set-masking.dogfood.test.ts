// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#20995] A field whose masking rule applies is served MASKED to a caller who
// resolves no permission set, on a real boot.
//
// `maskingRule` declares itself for "every non-system caller unless the
// field's `requiredPermissions` are ALL held". A caller who resolves no
// permission set holds nothing, so the rule applies to it. The door that
// produces that caller on a real composition is driven here: the record door,
// for a signed-in user on a deployment whose baseline is switched off
// (`fallbackPermissionSet: null`) and who holds no grant.
//
// [#21180] There used to be a second door — the public form's anonymous lookup
// picker, serving the referenced object's display fields to a visitor with no
// session. Ruling E on #21079 (comment 5933054144) retired the picker and
// deleted its route, so that case and the public form it booted left with it.
//
// What is asserted, by class: the scene is real (a system read carries the
// stored value); the field is served masked, never stored; a field with no
// rule beside it is served as stored (the door really served the row); and a
// predicate on the masked field is refused.
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST and
// auth layers. `@objectstack/plugin-security` resolves to its BUILT output
// here (no source alias), so build it before reading a verdict. Fixtures are
// synthetic.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { SecurityPlugin } from '@objectstack/plugin-security';

const CONTACT = 'zsmask_contact';
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

const zsmaskStack = defineStack({
  manifest: {
    id: 'com.dogfood.zero-set-mask',
    namespace: 'zsmask',
    version: '0.0.0',
    type: 'app',
    name: 'Zero-set Mask Fixture',
    description: 'One object with one masked field.',
  },
  objects: [ZsmaskContact],
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
