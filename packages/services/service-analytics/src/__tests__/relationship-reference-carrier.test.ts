// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// ADR-0021's relationship → target-object resolver used to gate the carrier
// with a truthiness test and return it: `if (… && field.reference) return
// field.reference`. An object- or array-valued `reference` passes that gate, so
// the JOINED TABLE for a dataset's `include` became a non-string — a value the
// declared contract (`FieldSchema.reference`, an optional STRING) never admits.
//
// The resolver's answer for a carrier no reader can read is now ABSENCE, which
// the resolver's own fallback turns into the compiler's "cannot resolve this
// relationship" refusal, plus one warning naming the field. The readable case
// is pinned alongside it, so a narrowing cannot be mistaken for a shutdown.

import { describe, it, expect, vi } from 'vitest';
import { AnalyticsServicePlugin } from '../plugin.js';

type Resolver = (baseObject: string, relationshipName: string) => string | undefined;

const OBJECTS: Record<string, { fields: Record<string, unknown> }> = {
  shop_order: {
    fields: {
      // Readable — the control.
      account: { type: 'lookup', reference: 'crm_account' },
      // Unreadable: an object where the target NAME belongs. Refused by
      // `ObjectSchema.safeParse`, so it only ever arrives unparsed.
      broken: { type: 'lookup', reference: { name: 'shop_invoice', fields: {} } },
      // Unreadable, array shape.
      broken_array: { type: 'master_detail', reference: ['shop_invoice'] },
      // Absence is legal and stays silent.
      untargeted: { type: 'lookup' },
    },
  },
};

async function bootResolver() {
  const warn = vi.fn();
  const registered: Record<string, unknown> = {};
  const ctx = {
    getService: (name: string) =>
      name === 'data'
        ? { getObject: (o: string) => OBJECTS[o], aggregate: async () => [], execute: async () => ({ rows: [] }) }
        : registered[name],
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
    logger: { info() {}, warn, error() {}, debug() {} },
  };
  await new AnalyticsServicePlugin().init(ctx as never);
  // The resolver is a closure built inside `init` and handed to the service as
  // config; the service's own field is the only handle on it. Driving a whole
  // dataset compile would add scaffolding without changing what is measured —
  // which value this function returns for an unreadable carrier.
  const resolver = (registered.analytics as unknown as { relationshipResolver: Resolver }).relationshipResolver;
  return { resolver, warn };
}

describe('analytics relationship resolver — an unreadable `reference` carrier', () => {
  it('answers `undefined` instead of a non-string joined table', async () => {
    const { resolver } = await bootResolver();
    expect(resolver('shop_order', 'broken')).toBeUndefined();
    expect(resolver('shop_order', 'broken_array')).toBeUndefined();
  });

  it('still resolves a readable target', async () => {
    const { resolver } = await bootResolver();
    expect(resolver('shop_order', 'account')).toBe('crm_account');
  });

  it('reports the unreadable carrier, and stays silent for a legal absence', async () => {
    const { resolver, warn } = await bootResolver();
    resolver('shop_order', 'untargeted');
    expect(warn.mock.calls.filter(args => String(args[0]).includes('untargeted'))).toHaveLength(0);
    resolver('shop_order', 'broken');
    const messages = warn.mock.calls.map(args => String(args[0]));
    expect(messages.some(m => m.includes('shop_order.broken'))).toBe(true);
    expect(messages.some(m => m.includes('Analytics.relationshipResolver'))).toBe(true);
  });
});
