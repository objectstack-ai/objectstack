// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * How the packaged-action ledger switch reads the responses behind it
 * (ADR-0126 §8 item 2; Studio's switch since objectstack#34724). The rule
 * worth measuring here is the one a DOM render cannot show cheaply and that a
 * wrong answer would make the switch lie about: an activation row read from
 * the wrong ledger slice, or from a driver that spells booleans 0/1, shows a
 * switched-OFF action as armed. And the object segment the flip addresses.
 */

import { describe, expect, it } from 'vitest';

import {
  GLOBAL_ACTION_OBJECT,
  ledgerPageTruncated,
  readActionActivation,
  readDataRecords,
  standaloneActionObjectName,
} from './packagedActions';

/** One `sys_metadata_activation` row as the data API answers it. */
function ledgerRow(over: Record<string, unknown>) {
  return {
    metadata_type: 'action',
    name: 'x',
    package_id: 'com.objectstack.crm',
    organization_id: null,
    active: true,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* Response readers                                                            */
/* -------------------------------------------------------------------------- */

describe('readDataRecords', () => {
  it('reads the wrapped and the bare form of one FindDataResponse', () => {
    expect(readDataRecords({ success: true, data: { object: 'x', records: [{ name: 'a' }] } })).toEqual([
      { name: 'a' },
    ]);
    expect(readDataRecords({ object: 'x', records: [{ name: 'b' }] })).toEqual([{ name: 'b' }]);
  });

  it('answers empty for anything that is not a record list', () => {
    expect(readDataRecords(null)).toEqual([]);
    expect(readDataRecords({ data: { records: 'nope' } })).toEqual([]);
    expect(readDataRecords(undefined)).toEqual([]);
  });
});

describe('ledgerPageTruncated', () => {
  it('is true only on an explicit hasMore', () => {
    expect(ledgerPageTruncated({ data: { hasMore: true } })).toBe(true);
    expect(ledgerPageTruncated({ hasMore: true })).toBe(true);
  });

  it('does not invent truncation from an absent or falsy field', () => {
    // A backend that omits `hasMore` is asserting nothing — `FindDataResponse`
    // declares it optional — and treating silence as truncation would blank
    // the section on every such deployment.
    expect(ledgerPageTruncated({ data: { records: [] } })).toBe(false);
    expect(ledgerPageTruncated({ data: { hasMore: false } })).toBe(false);
    expect(ledgerPageTruncated(null)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The ledger slice                                                            */
/* -------------------------------------------------------------------------- */

describe('readActionActivation', () => {
  it('takes only the action rows — the ledger is shared with flows', () => {
    const activation = readActionActivation([
      ledgerRow({ name: 'send_invoice', active: false }),
      ledgerRow({ metadata_type: 'flow', name: 'pkg_notify', active: false }),
    ]);
    expect(activation.get('send_invoice')).toBe(false);
    // A flow's row must not answer for an action of the same name, and must
    // not answer at all here.
    expect(activation.has('pkg_notify')).toBe(false);
  });

  it('skips a row scoped to an organization instead of merging it', () => {
    // §5 keeps the per-org dimension reserved and unwritten on this line, so a
    // row carrying one was not written by this door — reading it as
    // install-level would show one organization's choice as everyone's.
    const activation = readActionActivation([
      ledgerRow({ name: 'send_invoice', active: false, organization_id: 'org_1' }),
    ]);
    expect(activation.has('send_invoice')).toBe(false);
  });

  it('reads a 0/1 driver boolean the way the engine store does', () => {
    // SQLite/libsql round-trip booleans as 0/1. A `0` read as truthy would
    // show a disabled action as armed — the direction that matters.
    const activation = readActionActivation([
      ledgerRow({ name: 'zero', active: 0 }),
      ledgerRow({ name: 'one', active: 1 }),
      ledgerRow({ name: 'yes', active: true }),
    ]);
    expect(activation.get('zero')).toBe(false);
    expect(activation.get('one')).toBe(true);
    expect(activation.get('yes')).toBe(true);
  });

  it('ignores a row with no usable name', () => {
    expect(readActionActivation([ledgerRow({ name: '' }), ledgerRow({ name: 42 })]).size).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Owning object                                                               */
/* -------------------------------------------------------------------------- */

describe('standaloneActionObjectName', () => {
  it('follows the engine registration key: objectName, then object, then global', () => {
    expect(standaloneActionObjectName({ objectName: 'account' })).toBe('account');
    expect(standaloneActionObjectName({ object: 'contact' })).toBe('contact');
    expect(standaloneActionObjectName({})).toBe(GLOBAL_ACTION_OBJECT);
    expect(standaloneActionObjectName({ objectName: '' })).toBe(GLOBAL_ACTION_OBJECT);
  });

  it('spells the object-less case exactly as the activation door takes it', () => {
    // The `:object` segment is mandatory on `POST /actions/_activation/…`, and
    // `global` is the spelling both dispatch doors use. A different string
    // here would address a declaration the server cannot resolve.
    expect(GLOBAL_ACTION_OBJECT).toBe('global');
  });
});
