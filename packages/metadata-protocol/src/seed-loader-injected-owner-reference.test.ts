// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33791] `buildDependencyGraph` reads the injected `owner_id` as the person
 * lookup it is, on the AUTHORED definition the metadata service serves.
 *
 * The metadata service answers an object as its author wrote it. An object
 * that relies on the platform's `owner_id` declares no such field: the column
 * is added at registration by objectql's system-field pass, which reads
 * `resolveInjectedSystemColumns`. A graph built from the declared fields alone
 * therefore had no reference for `owner_id`, and a seed naming a person there
 * (`owner_id: 'Zhang Wei'`) was written as that text, while a declared
 * `Field.user()` on the same row resolved the same name to the user's id.
 *
 * ⛔ The assertions are on the `references` row, the thing resolution maps over;
 * the defect never threw.
 */

import { describe, it, expect, vi } from 'vitest';
import { SeedLoaderService } from './seed-loader.js';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

/**
 * The metadata service serves the authored definitions; the engine has no
 * schema registry, so nothing enriched can stand in for them.
 */
const graphOver = (authored: Record<string, unknown>, names: string[]) => {
  const metadata = { getObject: vi.fn(async (name: string) => authored[name]) } as unknown as IMetadataService;
  const engine = {} as unknown as IDataEngine;
  return new SeedLoaderService(engine, metadata, createLogger()).buildDependencyGraph(names);
};

const referencesOf = async (definition: Record<string, unknown>) =>
  (await graphOver({ [definition.name as string]: definition }, [definition.name as string])).nodes[0].references;

const invoice = (extra: Record<string, unknown> = {}) => ({
  name: 'crm_invoice',
  fields: { name: { type: 'text' }, amount: { type: 'number' } },
  ...extra,
});

describe('[#33791] the injected owner column is a person reference in the seed graph', () => {
  it('an object that declares no owner_id still gets an owner_id reference to sys_user, shaped like a declared lookup', async () => {
    const references = await referencesOf(invoice());
    expect(references).toEqual([
      { field: 'owner_id', targetObject: 'sys_user', targetField: 'name', fieldType: 'lookup', multiple: undefined },
    ]);
  });

  it('it takes the same row a declared sys_user lookup named owner_id takes', async () => {
    const injected = await referencesOf(invoice());
    const declared = await referencesOf(invoice({
      fields: { name: { type: 'text' }, amount: { type: 'number' }, owner_id: { type: 'lookup', reference: 'sys_user' } },
    }));
    expect(injected).toEqual(declared);
  });

  it('a declared owner_id wins: one reference, the author’s own type', async () => {
    const references = await referencesOf(invoice({
      fields: { name: { type: 'text' }, owner_id: { type: 'user' } },
    }));
    expect(references).toEqual([
      { field: 'owner_id', targetObject: 'sys_user', targetField: 'name', fieldType: 'user', multiple: undefined },
    ]);
  });

  it('a declared owner_id that is not a reference stays the author’s plain column', async () => {
    expect(await referencesOf(invoice({ fields: { name: { type: 'text' }, owner_id: { type: 'text' } } }))).toEqual([]);
  });

  // ── The boundary: every object the system-field pass gives no owner_id.
  it.each([
    ['ownership: org', invoice({ ownership: 'org' })],
    ['ownership: none', invoice({ ownership: 'none' })],
    ['ownership: business_unit', invoice({ ownership: 'business_unit' })],
    ['systemFields: false', invoice({ systemFields: false })],
    ['managedBy', invoice({ managedBy: 'engine-owned' })],
    ['a sys_ object', { name: 'sys_ledger', fields: { name: { type: 'text' } } }],
  ])('%s: no owner column is injected, so no owner reference appears', async (_label, definition) => {
    expect(await referencesOf(definition)).toEqual([]);
  });

  it('orders sys_user before the object when both are seeded, with no cycle', async () => {
    const graph = await graphOver(
      {
        sys_user: { name: 'sys_user', managedBy: 'better-auth', fields: { name: { type: 'text' }, email: { type: 'text' } } },
        crm_account: { name: 'crm_account', fields: { name: { type: 'text' } } },
        crm_invoice: invoice({ fields: { name: { type: 'text' }, account: { type: 'lookup', reference: 'crm_account' } } }),
      },
      ['crm_invoice', 'crm_account', 'sys_user'],
    );
    expect(graph.nodes.find((n) => n.object === 'crm_invoice')?.dependsOn).toEqual(['crm_account', 'sys_user']);
    expect(graph.nodes.find((n) => n.object === 'sys_user')?.dependsOn).toEqual([]);
    expect(graph.circularDependencies).toEqual([]);
    const at = (name: string) => graph.insertOrder.indexOf(name);
    expect(at('sys_user')).toBeLessThan(at('crm_invoice'));
    expect(at('crm_account')).toBeLessThan(at('crm_invoice'));
  });
});
