// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8414] The audit stops asking a federated remote for columns the platform
 * injected but never provisioned.
 *
 * `applySystemFields` injects `organization_id`, `owner_id`,
 * `owning_business_unit_id` and the audit `*_by` lookups into every registered
 * object, ADR-0015 `external` ones included — that derivation has no `external`
 * branch, deliberately (#7865, direction B). `Engine.syncObjectSchema` then
 * returns early for a federated object and issues no DDL. So five reference
 * columns exist in the registered schema and nowhere else, and this audit —
 * which enumerated reference fields off `fields` alone — asked the remote table
 * for every one of them, once per lifecycle sweep interval.
 *
 * ## The fixtures are built by the PRODUCER, not typed out here
 *
 * Every federated object below goes through the real `applySystemFields`, so
 * the anchors under test are the ones the registry actually injects, byte for
 * byte. A hand-written copy of the shipped definitions would keep passing
 * through a change to them — and the provenance verdict this fix depends on is
 * an EXACT identity match against those very tables, so a stale copy would not
 * fail loudly, it would silently answer `'author'` and quietly restore the
 * phantom projection.
 *
 * ## What each test is written to fail on
 *
 *  - remove the phantom filter        → "asks the remote for nothing" fails
 *  - widen it to `external != null`   → "a DECLARED remote anchor is still
 *                                        audited" fails (the #7859 lesson: an
 *                                        author's real column must keep its
 *                                        audit)
 *  - apply it to provisioned objects  → both LOCAL control tests fail
 *  - narrow it to `organization_id`   → "every injected anchor" fails
 */

import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { applySystemFields } from '../registry.js';
import {
  auditDanglingReferences,
  type AuditableObject,
  type DanglingReferenceAuditPort,
} from './dangling-reference-audit.js';

/** The five injected anchors that are REFERENCES (the audit ignores the datetimes). */
const INJECTED_REFERENCE_ANCHORS = [
  'organization_id',
  'created_by',
  'updated_by',
  'owner_id',
  'owning_business_unit_id',
] as const;

/** Run a document through the real injection pass, exactly as registration does. */
function register(doc: Record<string, unknown>): AuditableObject {
  return applySystemFields(doc as unknown as ServiceObject, {
    multiTenant: true,
  }) as unknown as AuditableObject;
}

/**
 * The showcase's federated customer, as the registry hands it to the audit:
 * bound to remote table `customers`, whose real columns are `id, name, email,
 * region, lifetime_value`. Not one of the injected anchors exists there.
 */
const federated = (): AuditableObject =>
  register({
    name: 'showcase_ext_customer',
    external: { remoteName: 'customers' },
    fields: {
      name: { type: 'text' },
      email: { type: 'text' },
      region: { type: 'text' },
      lifetime_value: { type: 'currency' },
    },
  });

/** An ordinary, platform-provisioned object — the control. */
const local = (): AuditableObject =>
  register({
    name: 'showcase_project',
    fields: {
      name: { type: 'text' },
      account: { type: 'lookup', reference: 'showcase_account' },
    },
  });

interface Observed {
  object: string;
  fields: unknown;
}

function makePort(objects: AuditableObject[], observed: Observed[]): DanglingReferenceAuditPort {
  return {
    objects: () => objects,
    async find(object, options) {
      observed.push({ object, fields: options.fields });
      // One row, every requested column empty — so any finding in the report
      // comes from the projection, never from fixture values.
      return [{ id: 'row_1' }];
    },
    async probe() {
      return true;
    },
  };
}

describe('[#8414] phantom injected columns are not projected off a federated remote', () => {
  it('asks the remote for NOTHING: a federated object whose only reference columns are injected anchors is never read', async () => {
    const observed: Observed[] = [];
    const report = await auditDanglingReferences(makePort([federated()], observed));

    // The registered schema really does carry all five — this is the
    // before-picture, and it is what makes the absence below meaningful
    // rather than a fixture that simply lacked them.
    const registered = Object.keys(federated().fields ?? {});
    for (const anchor of INJECTED_REFERENCE_ANCHORS) {
      expect(registered, `${anchor} must still be REGISTERED`).toContain(anchor);
    }

    expect(observed, 'no statement may reach the remote table').toEqual([]);
    expect(report.scanned).toBe(0);
    // Nothing was skipped for lack of budget: there was nothing to read.
    expect(report.unscannedObjects).toEqual([]);
    expect(report.unreadableObjects).toEqual([]);
  });

  it('a federated object that DECLARES a real remote reference is still audited — on that column only', async () => {
    const withRealRef = register({
      name: 'showcase_ext_order',
      external: { remoteName: 'orders' },
      fields: {
        // The author vouches for this remote column; a stored id in it can
        // genuinely dangle, so it must keep its audit.
        customer: { type: 'lookup', reference: 'showcase_ext_customer' },
        amount: { type: 'currency' },
      },
    });

    const observed: Observed[] = [];
    await auditDanglingReferences(makePort([withRealRef], observed));

    expect(observed).toHaveLength(1);
    expect(observed[0]!.fields).toEqual(['id', 'customer']);
  });

  it('a federated object that DECLARES an anchor NAME keeps auditing it — the predicate reads provenance, not `external != null`', async () => {
    // #7859's recorded reasoning, one consumer over: a federated object may
    // legitimately expose a real remote `organization_id`. The author's
    // definition is not the shipped one, so provenance answers `'author'`.
    const authorDeclaredAnchor = register({
      name: 'showcase_ext_tenanted',
      external: { remoteName: 'tenanted' },
      fields: {
        organization_id: { type: 'lookup', reference: 'sys_organization', label: 'Remote Org' },
        name: { type: 'text' },
      },
    });

    const observed: Observed[] = [];
    await auditDanglingReferences(makePort([authorDeclaredAnchor], observed));

    expect(observed).toHaveLength(1);
    expect(observed[0]!.fields).toEqual(['id', 'organization_id']);
  });

  it('POSITIVE CONTROL: an ordinary object is still swept with its FULL column set', async () => {
    const observed: Observed[] = [];
    await auditDanglingReferences(makePort([local()], observed));

    expect(observed).toHaveLength(1);
    expect(observed[0]!.object).toBe('showcase_project');
    expect(observed[0]!.fields).toEqual([
      'id',
      ...INJECTED_REFERENCE_ANCHORS,
      'account',
    ]);
  });

  it('POSITIVE CONTROL: mixing the two in one run narrows only the federated object', async () => {
    const observed: Observed[] = [];
    await auditDanglingReferences(makePort([local(), federated()], observed));

    expect(observed.map((o) => o.object)).toEqual(['showcase_project']);
    expect(observed[0]!.fields).toEqual([
      'id',
      ...INJECTED_REFERENCE_ANCHORS,
      'account',
    ]);
  });
});
