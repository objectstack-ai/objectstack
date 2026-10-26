// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which actions the packaged-ACTIONS section lists, and how it reads the two
 * responses behind a row (ADR-0126 §8 item 2).
 *
 * The rules worth measuring here are the ones a DOM render cannot show cheaply
 * and that a wrong answer would make the page lie about, in this order of
 * consequence:
 *
 *   1. an activation row read from the wrong ledger slice, or from a driver
 *      that spells booleans 0/1, shows a switched-OFF action as armed;
 *   2. the provenance question is asked of the wrong ITEM for an embedded
 *      action, which either hides an action from its only off-switch or offers
 *      an install-wide switch for something a tenant authored;
 *   3. the `<object>:<action>` dedup runs the wrong way and the row's label and
 *      provenance come from a declaration the server would not have resolved.
 */

import { describe, expect, it } from 'vitest';

import {
  GLOBAL_ACTION_OBJECT,
  collectPackagedActions,
  ledgerPageTruncated,
  packagedActionSource,
  readActionActivation,
  readDataRecords,
  standaloneActionObjectName,
} from './packagedActions';

/** A packaged object carrying embedded action declarations. */
function packagedObject(name: string, actions: Array<Record<string, unknown>>) {
  return { name, label: name, actions, _packageId: 'com.objectstack.crm', _provenance: 'package' };
}

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
/* Owning object + provenance source                                           */
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

describe('packagedActionSource', () => {
  const obj = { name: 'account', _packageId: 'com.objectstack.crm', _provenance: 'package' };

  it('falls through to the owning object for an embedded action', () => {
    // The registry stamps provenance on the item it registers — the object —
    // so an embedded action carries none and cannot answer for itself.
    expect(packagedActionSource({ name: 'send_invoice' }, obj)).toBe(obj);
  });

  it('lets a standalone item answer for itself, in both directions', () => {
    const packaged = { name: 'a', _packageId: 'com.objectstack.crm' };
    expect(packagedActionSource(packaged, obj)).toBe(packaged);
    // The case the fall-through would get wrong: a tenant-authored action
    // sitting on a PACKAGED object. It carries its own provenance, so it
    // answers, and the answer is "not packaged".
    const tenant = { name: 'a', _provenance: 'org' };
    expect(packagedActionSource(tenant, obj)).toBe(tenant);
  });
});

/* -------------------------------------------------------------------------- */
/* The join                                                                    */
/* -------------------------------------------------------------------------- */

describe('collectPackagedActions', () => {
  const objects = [
    packagedObject('account', [
      { name: 'send_invoice', label: 'Send invoice' },
      { name: 'archive', label: 'Archive' },
    ]),
    // A tenant-authored object overlay BOUND to a package: it carries a real
    // package id, so only the provenance clause keeps its actions off the page.
    { name: 'my_object', label: 'Mine', _packageId: 'app.crm', _provenance: 'org', actions: [{ name: 'mine', label: 'Mine' }] },
  ];

  it('lists the packaged embedded actions and leaves a tenant object\'s out', () => {
    const rows = collectPackagedActions(objects, [], new Map());
    expect(rows.map((r) => r.name)).toEqual(['archive', 'send_invoice']);
    expect(rows.every((r) => r.objectName === 'account')).toBe(true);
  });

  it('defaults to active and applies the ledger exceptions by name', () => {
    const rows = collectPackagedActions(objects, [], new Map([['send_invoice', false]]));
    // Absence of a row means the packaged default — active.
    expect(rows.find((r) => r.name === 'archive')?.enabled).toBe(true);
    expect(rows.find((r) => r.name === 'send_invoice')?.enabled).toBe(false);
  });

  it('includes a packaged STANDALONE action under its declared object', () => {
    const rows = collectPackagedActions(
      objects,
      [{ name: 'reindex', label: 'Reindex', objectName: 'account', _packageId: 'com.objectstack.crm', _provenance: 'package' }],
      new Map(),
    );
    expect(rows.find((r) => r.name === 'reindex')).toMatchObject({
      objectName: 'account',
      label: 'Reindex',
      enabled: true,
    });
  });

  it('lists an object-less standalone action under `global`', () => {
    const rows = collectPackagedActions(
      [],
      [{ name: 'nightly', label: 'Nightly', _packageId: 'com.objectstack.crm', _provenance: 'package' }],
      new Map(),
    );
    expect(rows).toEqual([
      { name: 'nightly', objectName: GLOBAL_ACTION_OBJECT, label: 'Nightly', enabled: true },
    ]);
  });

  it('lets the OBJECT-EMBEDDED declaration win a key clash', () => {
    // `collectActionDeclarations`' rule, mirroring the execution layer's
    // artifact-wins precedence. Backwards, the row would carry the label and
    // provenance of a declaration the server would never resolve or flip.
    const rows = collectPackagedActions(
      objects,
      [{ name: 'send_invoice', label: 'STANDALONE COPY', objectName: 'account', _packageId: 'com.objectstack.crm' }],
      new Map(),
    );
    const hits = rows.filter((r) => r.name === 'send_invoice');
    expect(hits).toHaveLength(1);
    expect(hits[0].label).toBe('Send invoice');
  });

  it('keeps BOTH rows when two objects declare the same action name', () => {
    // The ledger addresses an action by name alone (§4), so one row reaches
    // both — and the write door refuses the flip with a 409 that NAMES the
    // objects. Hiding a row here would replace that explanation with a guess.
    const rows = collectPackagedActions(
      [
        packagedObject('account', [{ name: 'export', label: 'Export' }]),
        packagedObject('contact', [{ name: 'export', label: 'Export' }]),
      ],
      [],
      new Map([['export', false]]),
    );
    expect(rows.map((r) => r.objectName)).toEqual(['account', 'contact']);
    // One ledger row, so both rows read the same state. That IS what the
    // ledger says, and the page reports it rather than inventing per-object
    // state the platform does not keep.
    expect(rows.every((r) => r.enabled === false)).toBe(true);
  });

  it('falls back to the machine name when a declaration has no label', () => {
    const rows = collectPackagedActions([packagedObject('account', [{ name: 'raw' }])], [], new Map());
    expect(rows[0].label).toBe('raw');
  });

  it('skips a declaration with no usable name', () => {
    const rows = collectPackagedActions(
      [packagedObject('account', [{ label: 'nameless' }, { name: '' }])],
      [],
      new Map(),
    );
    expect(rows).toEqual([]);
  });
});
