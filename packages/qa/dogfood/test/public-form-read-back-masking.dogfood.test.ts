// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21062] The record an anonymous public-form submit echoes back passes the
// result masker, on a real boot.
//
// The form-submit route authorizes the create through the ADR-0056
// declaration-derived grant, which passes before any permission set resolves.
// `maskingRule` declares itself for "every non-system caller unless the
// field's `requiredPermissions` are ALL held", and the anonymous submitter is a
// non-system caller, so every field whose rule applies is echoed masked: the
// one the form collects, and one filled from its `defaultValue` that the form
// never shows.
//
// Two deployment shapes are booted, because the caller the grant stands in for
// resolves differently on each: one that registers no guest set (the
// showcase's shape), and one whose stack declares the guest set the route's
// grant context names.
//
// What is asserted, by class: the scene is real (a system read of the created
// row holds the stored values); each masked field is echoed masked, never
// stored; the field with no rule is echoed as stored (the door really echoed
// the row); and the grant's admission is unchanged — the create succeeds and a
// server-managed field the submitter supplies never lands.
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, REST and
// auth layers. `@objectstack/plugin-security` resolves to its BUILT output
// here (no source alias), so build it before reading a verdict. Fixtures are
// synthetic.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { defineStack, defineView } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { definePermissionSet } from '@objectstack/spec/security';

const TICKET = 'pfmask_ticket';
const SLUG = 'pfmask-intake';
const RULE = { keepHead: 1, keepTail: 1 };
/** Synthetic stored values. */
const SUBJECT = 'Synthetic subject';
const ON_FORM = 'SYNTH4471VALUE';
const DEFAULTED = 'SYNTH8823DEFAULT';
const FORGED_OWNER = 'usr_pfmask_forged';
const SYS = { context: { isSystem: true } } as const;

const PfmaskTicket = ObjectSchema.create({
  name: TICKET,
  label: 'Public-form Mask Ticket',
  pluralLabel: 'Public-form Mask Tickets',
  sharingModel: 'public_read_write',
  fields: {
    subject: Field.text({ label: 'Subject', required: true }),
    pfmask_code: Field.text({ label: 'Code', maskingRule: RULE }),
    pfmask_stamp: Field.text({ label: 'Stamp', defaultValue: DEFAULTED, maskingRule: RULE }),
  },
});

const data = { provider: 'object' as const, object: TICKET };
const PfmaskTicketViews = defineView({
  list: { label: 'Tickets', type: 'grid', data, columns: [{ field: 'subject' }] },
  formViews: {
    intake: {
      type: 'simple',
      data,
      sections: [
        {
          name: 'intake',
          label: 'Intake',
          columns: 1,
          fields: [{ field: 'subject', required: true }, { field: 'pfmask_code' }],
        },
      ],
      sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${SLUG}` },
    },
  },
});

/** The guest set the form-submit route's grant context names, declared by the stack. */
const PfmaskGuestSet = definePermissionSet({
  name: 'guest_portal',
  label: 'Guest (Public Forms)',
  objects: { [TICKET]: { allowRead: false, allowCreate: true, allowEdit: false, allowDelete: false } },
});

const manifest = (suffix: string, description: string) => ({
  id: `com.dogfood.public-form-mask-${suffix}`,
  namespace: 'pfmask',
  version: '0.0.0',
  type: 'app' as const,
  name: 'Public-form Mask Fixture',
  description,
});

const noGuestSetStack = defineStack({
  manifest: manifest('no-guest-set', 'One object with two masked fields behind an anonymous form; no guest set.'),
  objects: [PfmaskTicket],
  views: [PfmaskTicketViews],
});

const guestSetStack = defineStack({
  manifest: manifest('guest-set', 'One object with two masked fields behind an anonymous form, and a guest set.'),
  objects: [PfmaskTicket],
  views: [PfmaskTicketViews],
  permissions: [PfmaskGuestSet],
});

type Stack = Parameters<typeof bootStack>[0];

function expectMasked(value: unknown, stored: string): void {
  expect(typeof value, 'the masked field is echoed, as a string').toBe('string');
  expect(value).not.toBe(stored);
  expect(String(value)).toContain('*');
  expect(String(value)).toHaveLength(stored.length);
}

async function submitAndRead(stackDef: unknown): Promise<void> {
  const stack = await bootStack(stackDef as Stack);
  try {
    const res = await stack.api(`/forms/${SLUG}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: SUBJECT, pfmask_code: ON_FORM, owner_id: FORGED_OWNER }),
    });
    expect(res.status, 'the anonymous create succeeds').toBe(201);
    const body = (await res.json()) as { id?: string; record: Record<string, unknown> };
    const id = String(body.record?.id ?? body.id ?? '');
    expect(id, 'the echo names the created row').toBeTruthy();

    const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
    const stored = await ql.findOne(TICKET, { where: { id }, ...SYS });
    expect(stored?.pfmask_code, 'the stored value is what a system read serves').toBe(ON_FORM);
    expect(stored?.pfmask_stamp, 'the default was stored').toBe(DEFAULTED);
    expect(stored?.owner_id ?? null, 'a server-managed field the submitter supplies never lands').not.toBe(FORGED_OWNER);

    expect(body.record.subject, 'the door echoed the row').toBe(SUBJECT);
    expectMasked(body.record.pfmask_code, ON_FORM);
    expectMasked(body.record.pfmask_stamp, DEFAULTED);
  } finally {
    await stack.stop();
  }
}

describe('[#21062] an anonymous public-form submit echoes every masked field masked', () => {
  it('on a deployment that registers no guest set', () => submitAndRead(noGuestSetStack), 120_000);
  it('on a deployment whose stack declares the guest set', () => submitAndRead(guestSetStack), 120_000);
});
