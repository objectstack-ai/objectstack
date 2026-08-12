// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7726 — `sys_invitation.status` and the spec's `InvitationStatus` are two
// spellings of one vocabulary, and they had drifted by exactly one value:
// better-auth's organization plugin writes `status: 'canceled'` on
// `POST /organization/cancel-invitation` (the `cancel_invitation` action below
// targets that route, and the object's own `expired` listView filters on the
// value), while the spec enum stopped at four. Anything validating a row
// against `InvitationSchema` therefore rejected an invitation the platform had
// just canceled through its own UI.
//
// The load-bearing pin is the PARITY assertion: the two sides are compared to
// each other, never to a hand-copied literal — a literal would have to be
// edited on both sides anyway, which is the drift it is supposed to catch. The
// object now reads its options FROM the enum, so today parity is structural;
// the test is what makes a future re-literalization land as a red test rather
// than as a silent second divergence.
import { describe, expect, it } from 'vitest';
import { InvitationStatus } from '@objectstack/spec/identity';
import { SysInvitation } from './sys-invitation.object.js';

/** Declared option values of a select field, in declaration order. */
function optionValues(object: unknown, field: string): string[] {
  const f = (object as any).fields?.[field];
  expect(f, `${field} field exists`).toBeDefined();
  expect(f.type).toBe('select');
  return ((f.options ?? []) as Array<{ value: unknown }>).map((o) => String(o.value));
}

/** Filter values of a named listView's `status` clause, or `[]` when absent. */
function listViewStatusValues(object: unknown, view: string): string[] {
  const v = (object as any).listViews?.[view];
  expect(v, `listView ${view} exists`).toBeDefined();
  const clause = ((v.filter ?? []) as Array<any>).find((c) => c?.field === 'status');
  if (!clause) return [];
  return (Array.isArray(clause.value) ? clause.value : [clause.value]).map(String);
}

describe('sys_invitation.status — vocabulary parity with the spec enum (#7726)', () => {
  it('matches InvitationStatus — the spec enum is the authority on the vocabulary', () => {
    // Order-sensitive: the options are rendered as a picklist, and the enum's
    // order is the one the object used before the binding existed.
    expect(optionValues(SysInvitation, 'status')).toEqual([...InvitationStatus.options]);
  });

  it('declares `canceled` — the terminal state cancel-invitation writes', () => {
    // Spelled as its own case because THIS is the regression: the writer is
    // upstream (better-auth), so dropping the value from either side breaks
    // nothing at write time and reappears only as a rejected validation.
    expect(optionValues(SysInvitation, 'status')).toContain('canceled');
    expect(InvitationStatus.options).toContain('canceled');
  });

  it('keeps every value the expired/canceled listView filters on inside the vocabulary', () => {
    // The listView is the read-side consumer that made the drift visible; a
    // filter value outside the vocabulary silently matches nothing.
    const filtered = listViewStatusValues(SysInvitation, 'expired');
    expect(filtered.length).toBeGreaterThan(0);
    for (const value of filtered) {
      expect(InvitationStatus.options).toContain(value);
    }
  });

  it('keeps `pending` as the default, and the default is a declared value', () => {
    const f = (SysInvitation as any).fields.status;
    expect(f.defaultValue).toBe('pending');
    expect(optionValues(SysInvitation, 'status')).toContain(f.defaultValue);
    expect(InvitationStatus.safeParse(f.defaultValue).success).toBe(true);
  });

  it('refuses a value outside the vocabulary', () => {
    // The other half of a value-domain pin: a widening that accidentally
    // relaxes the enum into a free string would satisfy every assertion above.
    expect(InvitationStatus.safeParse('cancelled').success).toBe(false);
    expect(optionValues(SysInvitation, 'status')).not.toContain('cancelled');
  });
});
