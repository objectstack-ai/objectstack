// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21918] `isFederatedUnprovisionedInjectedColumn` answers "the registry
 * injected this column into a federated object, and the object does not
 * provision it" for EVERY such column, and for nothing else.
 *
 * #21910 introduced the predicate for `organization_id` alone. The business
 * unit and user deletes then failed on the next anchors the same registry pass
 * injects (`owning_business_unit_id`, `owner_id`, `created_by`, `updated_by`),
 * so the predicate now reads the registry's own provenance
 * (`resolveInjectedColumnProvenance`, the #7865 marker) and names no column.
 *
 * Every schema below is the REGISTERED one, read back from a `SchemaRegistry`
 * after `registerObject`, because the provenance verdict is about the
 * definitions the injection actually stored, not about what the author wrote.
 *
 * The engine readers that ask the predicate are pinned at their seams:
 * `engine-cascade-federated-tenant-anchor.test.ts` (the cascade scan and its
 * plan) and `lifecycle/lifecycle-service.test.ts` (the tenant partition). The
 * enumeration of every reader is `federated-injected-column-readers.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { resolveInjectedColumnProvenance, unprovisionedInjectedColumns } from '@objectstack/spec/data';
import { SchemaRegistry } from './registry.js';
import { isFederatedObject, isFederatedUnprovisionedInjectedColumn } from './federated-object.js';

const REMOTE = 'remote_ds';

/** Federated, as the showcase declares its external objects: no column of the platform's own. */
const FEDERATED = {
  name: 'ext_customer',
  label: 'External Customer',
  datasource: REMOTE,
  external: { remoteName: 'customers' },
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

/** The same declaration with no `external` binding: the platform provisions its storage. */
const LOCAL = {
  name: 'acct',
  label: 'Account',
  fields: { name: { name: 'name', label: 'Name', type: 'text' as const } },
};

/**
 * Federated, with an `organization_id` and an `owner_id` the AUTHOR declared
 * (each maps a real remote column), and one more lookup of the author's own.
 */
const FEDERATED_AUTHOR_COLUMNS = {
  name: 'ext_tenant_customer',
  label: 'External Tenant Customer',
  datasource: REMOTE,
  external: { remoteName: 'tenant_customers' },
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' as const },
    organization_id: {
      name: 'organization_id',
      label: 'Remote Organization',
      type: 'lookup' as const,
      reference: 'sys_organization',
    },
    owner_id: { name: 'owner_id', label: 'Remote Owner', type: 'lookup' as const, reference: 'sys_user' },
    unit_ref: { name: 'unit_ref', label: 'Unit', type: 'lookup' as const, reference: 'sys_business_unit' },
  },
};

function registered(...objects: any[]): SchemaRegistry {
  const registry = new SchemaRegistry({ multiTenant: false, searchCompanion: false } as never);
  for (const o of objects) registry.registerObject(o, 'test-21918');
  return registry;
}

/** The injected lookups on a federated object, read off the registered schema's relation fields. */
function relationFieldsOf(schema: any): string[] {
  return Object.entries<any>(schema?.fields ?? {})
    .filter(([, f]) => f?.type === 'lookup' || f?.type === 'master_detail')
    .map(([name]) => name);
}

describe('[#21918] isFederatedUnprovisionedInjectedColumn: every injected column a federated object does not provision', () => {
  it('accepts every injected anchor of a federated object, the tenant anchor and every other one', () => {
    const schema = registered(FEDERATED).getObject('ext_customer');
    expect(isFederatedObject(schema)).toBe(true);

    // PREMISE: the registry injected these lookups, and its provenance calls
    // each one unprovisioned. The names are the measurement, not the decision.
    const relations = relationFieldsOf(schema);
    expect(relations).toEqual(
      expect.arrayContaining(['organization_id', 'owning_business_unit_id', 'owner_id', 'created_by', 'updated_by']),
    );

    for (const column of relations) {
      expect(resolveInjectedColumnProvenance(schema, column), column).toBe('injected-unprovisioned');
      expect(isFederatedUnprovisionedInjectedColumn(schema, column), column).toBe(true);
    }
    // The anchors past the tenant one, named, because they are what #21910's
    // tenant-only predicate missed and the business-unit and user deletes hit.
    expect(isFederatedUnprovisionedInjectedColumn(schema, 'owning_business_unit_id')).toBe(true);
    expect(isFederatedUnprovisionedInjectedColumn(schema, 'owner_id')).toBe(true);
    expect(isFederatedUnprovisionedInjectedColumn(schema, 'created_by')).toBe(true);
    expect(isFederatedUnprovisionedInjectedColumn(schema, 'updated_by')).toBe(true);
    // And the non-lookup audit columns, which the same pass injects.
    expect(isFederatedUnprovisionedInjectedColumn(schema, 'created_at')).toBe(true);
    expect(isFederatedUnprovisionedInjectedColumn(schema, 'updated_at')).toBe(true);
  });

  it('agrees with the registry provenance on every field of every registered object, and asks it for nothing else', () => {
    const registry = registered(FEDERATED, LOCAL, FEDERATED_AUTHOR_COLUMNS);
    for (const name of ['ext_customer', 'acct', 'ext_tenant_customer']) {
      const schema = registry.getObject(name);
      const unprovisioned = new Set(unprovisionedInjectedColumns(schema));
      for (const column of [...Object.keys((schema as any)?.fields ?? {}), 'id', 'no_such_column']) {
        expect(isFederatedUnprovisionedInjectedColumn(schema, column), `${name}.${column}`).toBe(unprovisioned.has(column));
      }
    }
  });

  it('refuses a column the author declared on a federated object, including its own organization_id and owner_id', () => {
    const schema = registered(FEDERATED_AUTHOR_COLUMNS).getObject('ext_tenant_customer');
    for (const column of ['organization_id', 'owner_id', 'unit_ref', 'name']) {
      expect(resolveInjectedColumnProvenance(schema, column), column).toBe('author');
      expect(isFederatedUnprovisionedInjectedColumn(schema, column), column).toBe(false);
    }
    // The anchors the author did NOT declare are still the registry's, and still unprovisioned.
    expect(isFederatedUnprovisionedInjectedColumn(schema, 'owning_business_unit_id')).toBe(true);
    expect(isFederatedUnprovisionedInjectedColumn(schema, 'created_by')).toBe(true);
  });

  it('refuses every injected column of a LOCAL object: the platform provisions its storage', () => {
    const schema = registered(LOCAL).getObject('acct');
    expect(isFederatedObject(schema)).toBe(false);
    for (const column of relationFieldsOf(schema)) {
      expect(resolveInjectedColumnProvenance(schema, column), column).toBe('injected-provisioned');
      expect(isFederatedUnprovisionedInjectedColumn(schema, column), column).toBe(false);
    }
  });

  it('refuses a column that is neither injected nor declared, and any input that is not an object', () => {
    const schema = registered(FEDERATED).getObject('ext_customer');
    expect(resolveInjectedColumnProvenance(schema, 'id')).toBe('absent');
    expect(isFederatedUnprovisionedInjectedColumn(schema, 'id')).toBe(false);
    expect(isFederatedUnprovisionedInjectedColumn(schema, 'no_such_column')).toBe(false);
    for (const input of [undefined, null, 'ext_customer', 42, []]) {
      expect(isFederatedUnprovisionedInjectedColumn(input, 'organization_id')).toBe(false);
    }
  });
});
