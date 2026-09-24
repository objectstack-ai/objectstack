// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19837] The audit hands the probe each scanned row's OWN organization.
 *
 * The write-path guard probes a reference under the writer's organization
 * (#19808), so a stored reference into another organization is one it now
 * refuses. The audit has no writer; to stay "never more or less strict than the
 * rule it reports on" it asks the same question under the organization the row
 * was stamped with. This suite pins the audit module's half of that: WHICH
 * organization reaches the port, which column it is read from, and that the
 * run's probe memo does not let one organization's answer stand in for
 * another's. The engine half (the organization becoming the probe's
 * `tenantId`) is pinned in `engine-reference-tenant-scope.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { applySystemFields } from '../registry.js';
import {
  auditDanglingReferences,
  type AuditableObject,
  type DanglingReferenceAuditPort,
} from './dangling-reference-audit.js';

/** Run a document through the real injection pass, exactly as registration does. */
function register(doc: Record<string, unknown>): AuditableObject {
  return applySystemFields(doc as unknown as ServiceObject, {
    multiTenant: true,
  }) as unknown as AuditableObject;
}

interface Probe {
  target: string;
  id: string;
  /** Recorded as received: `undefined` would fail every `null` below. */
  organization: string | null | undefined;
}

function makePort(
  objects: AuditableObject[],
  rows: Record<string, Array<Record<string, unknown>>>,
): DanglingReferenceAuditPort & { probes: Probe[]; projections: Record<string, unknown> } {
  const probes: Probe[] = [];
  const projections: Record<string, unknown> = {};
  return {
    probes,
    projections,
    objects: () => objects,
    async find(object, options) {
      projections[object] = options.fields;
      return rows[object] ?? [];
    },
    async probe(target, id, organization) {
      probes.push({ target, id: String(id), organization });
      return true;
    },
  };
}

/** Only the business reference's probes — the injected provenance family is not the subject here. */
const probesOf = (port: { probes: Probe[] }, target: string) => port.probes.filter((p) => p.target === target);

const TASK = register({
  name: 'ro_task',
  fields: {
    title: { type: 'text' },
    project: { type: 'lookup', reference: 'ro_project' },
  },
});

describe('[#19837] each audited reference is probed under its row\'s own organization', () => {
  it('the probe receives the organization the row was stamped with; a NULL-organization row probes unscoped', async () => {
    const port = makePort([TASK], {
      ro_task: [
        { id: 't_x', project: 'p_1', organization_id: 'org_x' },
        { id: 't_y', project: 'p_2', organization_id: 'org_y' },
        { id: 't_null', project: 'p_3', organization_id: null },
        { id: 't_empty', project: 'p_4', organization_id: '' },
      ],
    });

    await auditDanglingReferences(port);

    expect(probesOf(port, 'ro_project')).toEqual([
      { target: 'ro_project', id: 'p_1', organization: 'org_x' },
      { target: 'ro_project', id: 'p_2', organization: 'org_y' },
      { target: 'ro_project', id: 'p_3', organization: null },
      // `''` is "no organization", never an organization named the empty string.
      { target: 'ro_project', id: 'p_4', organization: null },
    ]);
  });

  it('the probe memo is keyed per organization — one organization\'s answer never stands in for another\'s', async () => {
    const port = makePort([TASK], {
      ro_task: [
        { id: 'a', project: 'p_shared', organization_id: 'org_x' },
        { id: 'b', project: 'p_shared', organization_id: 'org_x' },
        { id: 'c', project: 'p_shared', organization_id: 'org_y' },
        { id: 'd', project: 'p_shared', organization_id: null },
      ],
    });

    await auditDanglingReferences(port);

    // Same (target, id) under the same organization: probed once (#4551's memo).
    // Under another organization, or unscoped: asked again.
    expect(probesOf(port, 'ro_project').map((p) => p.organization)).toEqual(['org_x', 'org_y', null]);
  });

  it('a `tenancy.enabled: false` object has no tenant column to read — its rows probe unscoped', async () => {
    const catalog = register({
      name: 'ro_catalog',
      tenancy: { enabled: false },
      fields: {
        name: { type: 'text' },
        project: { type: 'lookup', reference: 'ro_project' },
      },
    });
    const port = makePort([catalog], {
      // Even a stamped value is not a scope for an object that opted out.
      ro_catalog: [{ id: 'c_1', project: 'p_1', organization_id: 'org_x' }],
    });

    await auditDanglingReferences(port);

    expect(probesOf(port, 'ro_project')).toEqual([{ target: 'ro_project', id: 'p_1', organization: null }]);
  });

  it('a declared `tenancy.tenantField` is the column read, and it is projected when nothing else asked for it', async () => {
    const ledger = register({
      name: 'ro_ledger',
      tenancy: { tenantField: 'company' },
      fields: {
        company: { type: 'text' },
        project: { type: 'lookup', reference: 'ro_project' },
      },
    });
    const port = makePort([ledger], {
      ro_ledger: [{ id: 'l_1', project: 'p_1', company: 'co_7', organization_id: 'org_x' }],
    });

    await auditDanglingReferences(port);

    expect(port.projections.ro_ledger).toContain('company');
    expect(probesOf(port, 'ro_project')).toEqual([{ target: 'ro_project', id: 'p_1', organization: 'co_7' }]);
  });

  it('a federated object\'s injected (phantom) organization column is not projected, and its rows probe unscoped', async () => {
    const order = register({
      name: 'ro_ext_order',
      external: { remoteName: 'orders' },
      fields: {
        customer: { type: 'lookup', reference: 'ro_customer' },
      },
    });
    const port = makePort([order], {
      ro_ext_order: [{ id: 'o_1', customer: 'cu_1' }],
    });

    await auditDanglingReferences(port);

    // #8414's narrowing survives: the remote is asked for the real column only.
    expect(port.projections.ro_ext_order).toEqual(['id', 'customer']);
    expect(port.probes).toEqual([{ target: 'ro_customer', id: 'cu_1', organization: null }]);
  });
});
