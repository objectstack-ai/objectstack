// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// `resolveLookupFields` used to gate the carrier with a truthiness test and
// then stringify it: `out.push({ key, reference: String(f.reference) })`. An
// object-valued `reference` passes truthiness and `String()` renders it as the
// literal target name `[object Object]` — a name that can never resolve, handed
// on to `engine.find(<object name>)` by the inbox display enrichment and lost
// inside that caller's own `catch`.
//
// `FieldSchema.reference` is declared an optional STRING, so the answer a
// reader owes for an unreadable carrier is ABSENCE. These cases pin both
// halves: the unreadable field is left out and reported, and a readable one is
// still carried through unchanged — otherwise "fixed" and "this path is now
// closed" would be indistinguishable.

import { describe, it, expect, vi } from 'vitest';
import { ApprovalService } from './approval-service.js';

/** The one engine member `resolveLookupFields` reads. */
const engineWithSchema = (fields: Record<string, unknown>) => ({
  getSchema: (_object: string) => ({ fields }),
}) as any;

const makeService = () => {
  const warn = vi.fn();
  const service = new ApprovalService({
    engine: engineWithSchema({
      // Readable: the control that keeps this a narrowing rather than a shutdown.
      account: { type: 'lookup', reference: 'crm_account' },
      // Unreadable: an `ObjectSchema` literal where the target NAME belongs.
      // `ObjectSchema.safeParse` refuses this at the contract door, so a value
      // in this shape reached the reader without ever passing parse.
      broken: { type: 'lookup', reference: { name: 'shop_invoice', fields: {} } },
      // Unreadable in the other shape the arbiter names.
      broken_array: { type: 'master_detail', reference: ['shop_invoice'] },
      // Absence is legal and stays silent: `.optional()` admits it.
      untargeted: { type: 'lookup' },
      // Not a reference-typed field at all.
      title: { type: 'text' },
    }),
    logger: { info() {}, warn, error() {}, debug() {} },
  });
  // `resolveLookupFields` is private and has no public seam: its sole consumer
  // is the inbox display enrichment, which swallows every failure by design.
  // Reading it directly is what makes the manufactured name assertable at all.
  const resolve = (object: string) =>
    (service as unknown as { resolveLookupFields(o: string): Array<{ key: string; reference: string }> })
      .resolveLookupFields(object);
  return { resolve, warn };
};

describe('ApprovalService.resolveLookupFields — an unreadable `reference` carrier', () => {
  it('never manufactures the literal target name `[object Object]`', () => {
    const { resolve } = makeService();
    const references = resolve('deal').map(f => f.reference);
    expect(references).not.toContain('[object Object]');
    // The general form of the same claim: nothing a `String()` of a non-string
    // could have produced survives into the result.
    for (const reference of references) {
      expect(typeof reference).toBe('string');
      expect(reference).not.toMatch(/^\[object /);
    }
  });

  it('leaves the unreadable fields out and still carries the readable one', () => {
    const { resolve } = makeService();
    expect(resolve('deal')).toEqual([{ key: 'account', reference: 'crm_account' }]);
  });

  it('reports each unreadable carrier instead of dropping it silently', () => {
    const { resolve, warn } = makeService();
    resolve('deal');
    const messages = warn.mock.calls.map(args => String(args[0]));
    expect(messages).toHaveLength(2);
    expect(messages.some(m => m.includes('deal.broken'))).toBe(true);
    expect(messages.some(m => m.includes('deal.broken_array'))).toBe(true);
    // The refusal names the reader and says what to write instead.
    expect(messages.every(m => m.includes('ApprovalService.resolveLookupFields'))).toBe(true);
  });

  it('stays silent for a field that legitimately names no target', () => {
    const { resolve, warn } = makeService();
    resolve('deal');
    expect(warn.mock.calls.every(args => !String(args[0]).includes('untargeted'))).toBe(true);
  });
});
