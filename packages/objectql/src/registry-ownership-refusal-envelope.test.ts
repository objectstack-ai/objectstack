// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14367 — `SchemaRegistry.registerObject`'s cross-package ownership refusal
 * carries an ADR-0112 envelope.
 *
 * ## What this pins, and why an envelope rather than a throw
 *
 * The refusal (ADR-0029 D3, single owner per object name) used to be a bare
 * `Error`. Measured while reverse-verifying the install-time
 * `DUPLICATE_ARTIFACT_OBJECT_NAME` check one layer up (#14163): with that
 * check ablated, `expect(refused).toBeDefined()` STAYED GREEN, because this
 * refusal fired one step later and looked, to a throw-shaped assertion,
 * exactly like the check that had just been deleted. Only the envelope
 * assertion (`code` + `status`) went red. So every rejection test on this
 * path could only be a bare `toThrow()` — precisely the assertion ADR-0112
 * and ADR-0130 D3 rule out by name.
 *
 * Three facts, each its own case so a failure reads as the specific
 * regression:
 *
 *   1. the refusal is `ObjectOwnershipConflictError` with `code` +
 *      `status: 422` (and the two package ids + the object name as fields);
 *   2. the message text is byte-for-byte what the bare `Error` carried —
 *      the fence that keeps every message-substring assertion and every
 *      `console.warn` forwarder unchanged;
 *   3. the ADR-0029 D9 §6.1 late-install branch beside it (a TENANT-authored
 *      sitting owner) is NOT a refusal and does not throw this class — or
 *      anything.
 */

import { describe, it, expect } from 'vitest';
import { ObjectOwnershipConflictError, SchemaRegistry } from './registry.js';

const APP_PKG = 'app.myapp';
const OTHER_PKG = 'app.otherapp';

const packagedBody = (name: string) => ({
  name,
  label: 'Invoice',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name' },
    packaged_only: { name: 'packaged_only', type: 'text', label: 'Packaged only' },
  },
});

const silent = () => {
  const r = new SchemaRegistry({ multiTenant: false });
  r.logLevel = 'silent';
  return r;
};

const kinds = (r: SchemaRegistry, name: string) =>
  r.getObjectContributors(name).map((c) => c.ownership);

/** What a synchronous registration REFUSED with, or `undefined` when it did not refuse. */
const refusalOf = (run: () => unknown): unknown => {
  try {
    run();
    return undefined;
  } catch (e) {
    return e;
  }
};

/**
 * The text the bare `Error` carried, spelled out in full rather than matched
 * by substring: a substring match would stay green through a rewording that
 * still contained the fragment, and the whole point of the fence is that the
 * forwarders' `console.warn` lines and the existing regex assertions read the
 * SAME bytes as before.
 */
const LEGACY_MESSAGE =
  'Object "myapp_invoice" is already owned by package "app.myapp". ' +
  "Package \"app.otherapp\" cannot claim ownership. Use 'extend' to add fields.";

describe('#14367 — the cross-package ownership refusal is an ADR-0112 envelope', () => {
  it('refuses a second code package with `ObjectOwnershipConflictError`: code + status 422, both packages and the object named', () => {
    const r = silent();
    r.registerObject(packagedBody('myapp_invoice') as any, APP_PKG);

    const refused = refusalOf(() => r.registerObject(packagedBody('myapp_invoice') as any, OTHER_PKG));

    expect(refused).toBeInstanceOf(ObjectOwnershipConflictError);
    // The envelope — never a bare `toThrow()`.
    expect(refused).toMatchObject({ code: 'OBJECT_OWNERSHIP_CONFLICT', status: 422 });
    const err = refused as ObjectOwnershipConflictError;
    expect(err.name).toBe('ObjectOwnershipConflictError');
    expect(err.objectName).toBe('myapp_invoice');
    expect(err.existingPackageId).toBe(APP_PKG);
    expect(err.incomingPackageId).toBe(OTHER_PKG);
    // Nothing half-applied: the sitting owner is untouched.
    expect(kinds(r, 'myapp_invoice')).toEqual(['own']);
    expect(r.getObjectOwner('myapp_invoice')?.packageId).toBe(APP_PKG);
  });

  it('keeps the message text byte-for-byte — the fence every substring assertion and forwarder relies on', () => {
    const r = silent();
    r.registerObject(packagedBody('myapp_invoice') as any, APP_PKG);

    const refused = refusalOf(() => r.registerObject(packagedBody('myapp_invoice') as any, OTHER_PKG));

    expect((refused as Error).message).toBe(LEGACY_MESSAGE);
    // …and the existing sites' regex still matches it, which is the same fact
    // from the other side.
    expect((refused as Error).message).toMatch(/already owned by package "app\.myapp"/);
  });

  it('the class is constructible on its own with the same envelope and the same text', () => {
    // Pinned directly so a change to the constructor's message template is a
    // change to THIS line, not only to whatever registry path happens to
    // exercise it.
    const err = new ObjectOwnershipConflictError('myapp_invoice', APP_PKG, OTHER_PKG);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('OBJECT_OWNERSHIP_CONFLICT');
    expect(err.status).toBe(422);
    expect(err.message).toBe(LEGACY_MESSAGE);
  });

  /**
   * THE FENCE (ADR-0029 D9 §6.1). A code package registering an object a
   * TENANT row already holds is a late install, not a refusal: the code layer
   * takes ownership and the tenant contribution becomes its overlay. Out of
   * scope for the envelope by ruling, and pinned here so the envelope cannot
   * creep onto it: the branch throws nothing at all.
   */
  it('does NOT refuse the D9 §6.1 late install — a tenant-authored sitting owner is re-classified, nothing is thrown', () => {
    const r = silent();
    r.registerObject(
      { ...packagedBody('myapp_invoice'), _provenance: 'org' } as any,
      'sys_metadata',
    );

    const refused = refusalOf(() => r.registerObject(packagedBody('myapp_invoice') as any, APP_PKG));

    expect(refused).toBeUndefined();
    expect(refused).not.toBeInstanceOf(ObjectOwnershipConflictError);
    expect(kinds(r, 'myapp_invoice')).toEqual(['own', 'overlay']);
    expect(r.getObjectOwner('myapp_invoice')?.packageId).toBe(APP_PKG);
  });

  /** The remedy the message prescribes is not a claim: `extend` from another package is accepted. */
  it("accepts the message's own remedy — an `extend` from the other package is not an ownership claim", () => {
    const r = silent();
    r.registerObject(packagedBody('myapp_invoice') as any, APP_PKG);

    const refused = refusalOf(() =>
      r.registerObject(
        { name: 'myapp_invoice', fields: { ext_field: { name: 'ext_field', type: 'text' } } } as any,
        OTHER_PKG, undefined, 'extend',
      ),
    );

    expect(refused).toBeUndefined();
    expect(kinds(r, 'myapp_invoice')).toEqual(['own', 'extend']);
    expect(r.getObjectOwner('myapp_invoice')?.packageId).toBe(APP_PKG);
  });
});
