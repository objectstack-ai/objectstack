// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21788] Federated validation compares what the remote owns, and nothing the
 * platform injected.
 *
 * ## The defect this pins closed
 *
 * The registry injects anchors onto every object it registers — on a federated
 * one `organization_id`, `created_by`, `updated_by`, `owner_id` and
 * `owning_business_unit_id`, with no storage behind them (the remote owns the
 * schema). A stored federated object (saved through `PUT /meta/object` or the
 * external-table import, rehydrated at boot) is read back as the registry
 * holds it, anchors included, and `validateObjectUsing` compared every field
 * but `id` / `created_at` / `updated_at` with the remote table. So each anchor
 * came back as a `missing_column` at error severity, and the boot validation
 * gate aborted any datasource with the default `onMismatch: 'fail'`. Measured
 * on the showcase: "Object '…' does not match its remote table" listing exactly
 * those five columns, for an object whose remote table was intact.
 *
 * ## What each case pins
 *
 *  - an object carrying the platform's own anchor definitions validates `ok`,
 *    on the single-object read and on the per-datasource sweep the gate runs;
 *  - the NEGATIVE CONTROL: a declared business column the remote lacks is
 *    still a `missing_column` at error severity — the only diff, so the gate's
 *    `fail` policy (which aborts on any measured diff) still aborts on real
 *    drift;
 *  - an author-declared field that only shares an anchor's NAME is the
 *    author's (`resolveInjectedColumnProvenance` answers `'author'`) and is
 *    still compared.
 *
 * The anchors are built with the spec's own `injectedSystemColumnDefs`, so the
 * fixture carries the bytes the registry injects rather than a copy of them.
 */

import { describe, it, expect } from 'vitest';
import type { IntrospectedSchema } from '@objectstack/spec/contracts';
import { injectedSystemColumnDefs } from '@objectstack/spec/data';
import {
  ExternalDatasourceService,
  type DatasourceLike,
  type ObjectLike,
} from '../external-datasource-service.js';

const ANCHORS = ['organization_id', 'created_by', 'updated_by', 'owner_id', 'owning_business_unit_id'];

const remoteSchema = (): IntrospectedSchema =>
  ({
    dialect: 'sqlite',
    tables: {
      customers: {
        name: 'customers',
        indexes: [],
        columns: [
          { name: 'id', type: 'text', nullable: false, primaryKey: true },
          { name: 'name', type: 'text', nullable: true, primaryKey: false },
          { name: 'email', type: 'text', nullable: true, primaryKey: false },
        ],
      },
    },
  }) as unknown as IntrospectedSchema;

/** A federated object as the import authors it. */
function authored(extraFields: Record<string, Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    name: 'ext_cust',
    label: 'Ext Cust',
    datasource: 'ext',
    external: { remoteName: 'customers' },
    fields: { id: { type: 'text' }, name: { type: 'text' }, email: { type: 'text' }, ...extraFields },
    sharingModel: 'private',
  };
}

/** The same object as the registry holds it: the platform's anchors injected into `fields`. */
function stored(def: Record<string, unknown>): ObjectLike {
  const fields = def.fields as Record<string, unknown>;
  return { ...def, fields: { ...injectedSystemColumnDefs(def), ...fields } } as unknown as ObjectLike;
}

function service(objects: ObjectLike[]): ExternalDatasourceService {
  const ds: DatasourceLike = { name: 'ext', schemaMode: 'external' };
  return new ExternalDatasourceService({
    introspect: async () => remoteSchema(),
    getDatasource: async (n) => (n === ds.name ? ds : undefined),
    getObject: async (n) => objects.find((o) => o.name === n),
    listObjects: async () => objects,
  });
}

describe('federated validation skips the platform\'s unprovisioned anchors (#21788)', () => {
  it('the fixture carries the anchors the platform injects (so the cases below are not vacuous)', () => {
    expect(Object.keys(stored(authored()).fields ?? {})).toEqual(expect.arrayContaining(ANCHORS));
  });

  it('a stored federated object carrying the injected anchors validates ok', async () => {
    const svc = service([stored(authored())]);

    expect(await svc.validateObject('ext_cust')).toEqual({ ok: true, datasource: 'ext', object: 'ext_cust', diffs: [] });
    expect(await svc.validateDatasource('ext')).toEqual({
      ok: true,
      results: [{ ok: true, datasource: 'ext', object: 'ext_cust', diffs: [] }],
    });
  });

  it('negative control: a declared business column the remote lacks is still a missing_column at error severity, and the only diff', async () => {
    const svc = service([stored(authored({ loyalty_tier: { type: 'text' } }))]);

    const result = await svc.validateObject('ext_cust');

    expect(result.ok).toBe(false);
    expect(result.diffs).toEqual([
      { kind: 'missing_column', remoteName: 'customers', column: 'loyalty_tier', severity: 'error' },
    ]);
    expect((await svc.validateDatasource('ext')).ok).toBe(false);
  });

  it('an author-declared field that only shares an anchor\'s name is still compared', async () => {
    const svc = service([stored(authored({ owner_id: { type: 'text', label: 'Account owner' } }))]);

    expect((await svc.validateObject('ext_cust')).diffs).toEqual([
      { kind: 'missing_column', remoteName: 'customers', column: 'owner_id', severity: 'error' },
    ]);
  });
});
