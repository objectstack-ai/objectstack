// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22437] An anonymous public-form submit answers `201` with the created
// record's id, and nothing the insert stored — on a real boot, with a hook
// that derives a field from an EXISTING record.
//
// The door used to answer with the row as stored after the insert pipeline.
// The form's field whitelist filters what the caller may WRITE; nothing
// filtered what it was then SHOWN. A `beforeInsert` hook that runs elevated
// (`runAs: 'system'`) may read records the anonymous caller's grant can never
// read, and stamp what it found onto the new row — and the echo then handed
// that finding to anyone on the internet: whether a submitted value matches an
// existing record, and which one.
//
// The fixture is that shape, synthetic: a form-target object whose elevated
// `beforeInsert` hook looks the submitted email up among existing contacts and
// stamps the match onto the new row. Two deployment shapes are booted, because
// the caller the form grant stands in for resolves differently on each: one
// that registers no guest set, and one whose stack declares the guest set the
// route's grant context names (reading neither object).
//
// What is asserted, by class:
//   - the scene is real: a system read of the created row holds the stamp, so
//     the hook ran elevated and found the existing record;
//   - the answer is exactly `{ id }`: neither the stamp, nor any other stored
//     field, nor the existing record's id under any key;
//   - control: the answer still says `201`, and its top-level `id` — the key
//     path the console's success screen reads — names the row that landed.
//
// `bootStack` with the real `SecurityPlugin`, `ObjectQL`, SQL driver, hook
// sandbox, REST and auth layers. `@objectstack/rest` resolves to its BUILT
// output here (no source alias), so build it before reading a verdict.

import { describe, it, expect } from 'vitest';
import { bootStack } from '@objectstack/verify';
import { defineStack, defineView } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';
import { definePermissionSet } from '@objectstack/spec/security';

const CONTACT = 'pfans_contact';
const REQUEST = 'pfans_request';
const SLUG = 'pfans-intake';
const SYS = { context: { isSystem: true } } as const;
/** Synthetic values. */
const KNOWN_EMAIL = 'known-7311@example.test';
const SUBJECT = 'Synthetic subject 7311';
const MATCH_KIND = 'SYNTH_EXISTING_MATCH';
const DEFAULTED = 'SYNTH_DEFAULT_STAGE';

/** The existing records the hook reads; no anonymous caller may read them. */
const PfansContact = ObjectSchema.create({
  name: CONTACT,
  label: 'Answer Contact',
  pluralLabel: 'Answer Contacts',
  sharingModel: 'private',
  fields: {
    name: Field.text({ label: 'Name' }),
    email: Field.text({ label: 'Email' }),
  },
});

/** The form's target: two declared fields, two stamped by the hook, one defaulted. */
const PfansRequest = ObjectSchema.create({
  name: REQUEST,
  label: 'Answer Request',
  pluralLabel: 'Answer Requests',
  sharingModel: 'private',
  fields: {
    subject: Field.text({ label: 'Subject', required: true }),
    email: Field.text({ label: 'Email' }),
    match_ref: Field.text({ label: 'Match reference' }),
    match_kind: Field.text({ label: 'Match kind' }),
    stage: Field.text({ label: 'Stage', defaultValue: DEFAULTED }),
  },
});

const data = { provider: 'object' as const, object: REQUEST };
const PfansRequestViews = defineView({
  list: { label: 'Requests', type: 'grid', data, columns: [{ field: 'subject' }] },
  formViews: {
    intake: {
      type: 'simple',
      data,
      sections: [
        {
          name: 'intake',
          label: 'Intake',
          columns: 1,
          fields: [{ field: 'subject', required: true }, { field: 'email' }],
        },
      ],
      sharing: { enabled: true, allowAnonymous: true, publicLink: `/forms/${SLUG}` },
    },
  },
});

/** Look the submitted email up among existing contacts, elevated, and stamp the match. */
const MATCH_SOURCE = `
  var rows = await ctx.api.object('${CONTACT}').find({ where: { email: ctx.input.email } });
  if (rows && rows.length > 0) {
    ctx.input.match_ref = rows[0].id;
    ctx.input.match_kind = '${MATCH_KIND}';
  }
`;

const matchExistingHook = {
  name: 'pfans_match_existing',
  label: 'Match an existing contact',
  object: REQUEST,
  events: ['beforeInsert'],
  runAs: 'system',
  body: { language: 'js', source: MATCH_SOURCE, capabilities: ['api.read'] },
};

/** The guest set the form-submit route's grant context names, declared by the stack. */
const PfansGuestSet = definePermissionSet({
  name: 'guest_portal',
  label: 'Guest (Public Forms)',
  objects: {
    [REQUEST]: { allowRead: false, allowCreate: true, allowEdit: false, allowDelete: false },
    [CONTACT]: { allowRead: false, allowCreate: false, allowEdit: false, allowDelete: false },
  },
});

const manifest = (suffix: string, description: string) => ({
  id: `com.dogfood.public-form-answer-${suffix}`,
  namespace: 'pfans',
  version: '0.0.0',
  type: 'app' as const,
  name: 'Public-form Answer Fixture',
  description,
});

const noGuestSetStack = defineStack({
  manifest: manifest('no-guest-set', 'An anonymous form whose elevated hook stamps a match from existing records; no guest set.'),
  objects: [PfansContact, PfansRequest],
  views: [PfansRequestViews],
  hooks: [matchExistingHook],
} as any);

const guestSetStack = defineStack({
  manifest: manifest('guest-set', 'An anonymous form whose elevated hook stamps a match from existing records, and a guest set.'),
  objects: [PfansContact, PfansRequest],
  views: [PfansRequestViews],
  hooks: [matchExistingHook],
  permissions: [PfansGuestSet],
} as any);

type Stack = Parameters<typeof bootStack>[0];

async function submitAndRead(stackDef: unknown): Promise<void> {
  const stack = await bootStack(stackDef as Stack);
  try {
    const ql = (await stack.kernel.getServiceAsync('objectql')) as any;
    const existing = await ql.insert(CONTACT, { name: 'Existing', email: KNOWN_EMAIL }, SYS);
    expect(existing?.id, 'the existing record the hook will find').toBeTruthy();

    const res = await stack.api(`/forms/${SLUG}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: SUBJECT, email: KNOWN_EMAIL }),
    });
    const wire = await res.text();
    expect(res.status, wire).toBe(201);
    const body = JSON.parse(wire) as Record<string, unknown>;

    // Control: the key path the console reads the created id from. No
    // `{ success, data }` envelope, so the top-level `id` is what it reads.
    expect('success' in body).toBe(false);
    expect(typeof body.id, 'the created id is a string at the top level').toBe('string');
    const id = body.id as string;
    expect(id).not.toBe('');

    // The scene is real: the row landed under that id, and the hook ran
    // elevated and stamped what it found among the existing records.
    const stored = await ql.findOne(REQUEST, { where: { id }, ...SYS });
    expect(stored, 'the answer names the row that landed').toBeTruthy();
    expect(stored.subject).toBe(SUBJECT);
    expect(stored.match_ref, 'the elevated hook found the existing record').toBe(existing.id);
    expect(stored.match_kind).toBe(MATCH_KIND);
    expect(stored.stage, 'the default was stored').toBe(DEFAULTED);

    // The answer is the id, and nothing the insert stored.
    expect(body).toEqual({ id });
    for (const key of Object.keys(stored)) {
      if (key === 'id') continue;
      expect(body, `stored field ${key} must not reach the anonymous caller`).not.toHaveProperty(key);
    }
    for (const value of [existing.id, MATCH_KIND, DEFAULTED]) {
      expect(wire, 'a derived or defaulted value must not reach the anonymous caller under any key')
        .not.toContain(String(value));
    }
  } finally {
    await stack.stop();
  }
}

describe('[#22437] an anonymous public-form submit answers the created id, and nothing the insert stored', () => {
  it('on a deployment that registers no guest set', () => submitAndRead(noGuestSetStack), 120_000);
  it('on a deployment whose stack declares the guest set', () => submitAndRead(guestSetStack), 120_000);
});
