// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10202 — `dropServedPicklistOptions`, the served → authored
 * conversion a writer that seeded its body from a served object read applies
 * to the body it PUTs. Moved here from `@object-ui/app-shell` with the helper
 * by objectui#11692, so the writers in `@object-ui/plugin-designer` share it.
 *
 * The contract it answers to is read from the installed `@objectstack/spec`,
 * not restated: `FieldSchema` refuses `picklist` beside `options` (the served
 * form), accepts `picklist` alone (the authored form), and `ObjectSchema`
 * refuses a whole document that carries one served field. So the pins below say
 * what the helper does AND that what it produces is what the door accepts.
 */

import { describe, expect, it } from 'vitest';
import { FieldSchema, ObjectSchema } from '@objectstack/spec/data';
import { dropServedPicklistOptions } from './picklist-binding';

type Row = Record<string, unknown>;

/** The options the runtime resolved onto a bound field: the list's own plus an extension's. */
const RESOLVED = [
  { label: 'Gold', value: 'gold', color: '#d4af37' },
  { label: 'Silver', value: 'silver' },
  { label: 'Platinum', value: 'platinum' },
];

/** A served object: two bound fields (single and multi), an inline select, a text field. */
function servedObject(): Row {
  return {
    name: 'acme_account',
    label: 'Account',
    fields: {
      tier: { type: 'select', label: 'Tier', picklist: 'acme_tier', options: RESOLVED.map((o) => ({ ...o })) },
      regions: { type: 'multiselect', label: 'Regions', picklist: 'acme_region', options: [{ label: 'EU', value: 'eu' }] },
      status: { type: 'select', label: 'Status', options: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }] },
      title: { type: 'text', label: 'Title', maxLength: 200 },
    },
  };
}

describe('dropServedPicklistOptions (objectui#10202)', () => {
  it('premise, read off the installed spec: a served field is refused at `options`, the authored form is accepted', () => {
    const served = FieldSchema.safeParse({ type: 'select', label: 'Tier', picklist: 'acme_tier', options: RESOLVED });
    expect(served.success).toBe(false);
    expect(served.error?.issues.map((i) => i.path.join('.'))).toContain('options');
    expect(FieldSchema.safeParse({ type: 'select', label: 'Tier', picklist: 'acme_tier' }).success).toBe(true);
    // And the whole document is refused while one served field rides in it.
    expect(ObjectSchema.safeParse(servedObject()).success).toBe(false);
  });

  it('drops `options` from EVERY picklist-bound field, and the result is a document the door accepts', () => {
    const body = dropServedPicklistOptions(servedObject());
    const fields = body.fields as Record<string, Row>;
    expect(fields.tier).toEqual({ type: 'select', label: 'Tier', picklist: 'acme_tier' });
    expect(fields.regions).toEqual({ type: 'multiselect', label: 'Regions', picklist: 'acme_region' });
    expect(fields.tier).not.toHaveProperty('options');
    expect(fields.regions).not.toHaveProperty('options');
    const parsed = ObjectSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('strips nothing else: a field without `picklist` keeps its inline options byte-identical, and so does every other key', () => {
    const input = servedObject();
    const before = JSON.stringify(input);
    const body = dropServedPicklistOptions(input);
    const inFields = input.fields as Record<string, Row>;
    const outFields = body.fields as Record<string, Row>;
    // Untouched fields are the SAME objects, not copies.
    expect(outFields.status).toBe(inFields.status);
    expect(outFields.title).toBe(inFields.title);
    expect(JSON.stringify(outFields.status)).toBe(JSON.stringify(inFields.status));
    // Document keys other than `fields` ride along unchanged, in order.
    expect(Object.keys(body)).toEqual(Object.keys(input));
    expect(body.name).toBe('acme_account');
    expect(body.label).toBe('Account');
    // Field order is preserved (declaration order IS the designer's order).
    expect(Object.keys(outFields)).toEqual(['tier', 'regions', 'status', 'title']);
    // The input is never mutated.
    expect(JSON.stringify(input)).toBe(before);
  });

  it('handles the ARRAY `fields` shape a document can arrive in', () => {
    const input: Row = {
      name: 'acme_account',
      fields: [
        { name: 'tier', type: 'select', picklist: 'acme_tier', options: RESOLVED },
        { name: 'status', type: 'select', options: [{ label: 'Open', value: 'open' }] },
      ],
    };
    const body = dropServedPicklistOptions(input);
    const out = body.fields as Row[];
    expect(out[0]).toEqual({ name: 'tier', type: 'select', picklist: 'acme_tier' });
    expect(out[1]).toBe((input.fields as Row[])[1]);
  });

  it('comes back BY REFERENCE when no bound field carries options', () => {
    const authored: Row = {
      name: 'acme_account',
      fields: { tier: { type: 'select', picklist: 'acme_tier' }, status: { type: 'select', options: [{ label: 'Open', value: 'open' }] } },
    };
    expect(dropServedPicklistOptions(authored)).toBe(authored);
    const noFields: Row = { name: 'acme_account' };
    expect(dropServedPicklistOptions(noFields)).toBe(noFields);
    const asArray: Row = { name: 'x', fields: [{ name: 'status', type: 'select', options: [{ label: 'A', value: 'a' }] }] };
    expect(dropServedPicklistOptions(asArray)).toBe(asArray);
  });

  it('keeps a field literally named `__proto__` as an own key', () => {
    const fields = Object.fromEntries([
      ['__proto__', { type: 'select', picklist: 'acme_tier', options: RESOLVED }],
    ]);
    const body = dropServedPicklistOptions({ name: 'x', fields });
    const out = body.fields as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual({ type: 'select', picklist: 'acme_tier' });
  });
});
