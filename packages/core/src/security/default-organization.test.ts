// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3/D5] The one definition of the Default Organization, pinned on
 * its own: `slug = 'default'`, else the only organization, else none. Every
 * reader (the resolver, plugin-auth's boot invariant, bootstrap, tenancy
 * service and last-admin guard, plugin-security's promotion, the ownership
 * ceremony) hands its read to this rule, so these cases are what all of them
 * answer.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_ORGANIZATION_SLUG, findDefaultOrganization } from './default-organization.js';
import { readDefaultOrganizationId } from './resolve-authz-context.js';

type Row = { id?: unknown; slug?: string };

/** A read over `rows` that answers the two questions the rule asks, and records them. */
function readOver(rows: Row[]) {
  const asked: Array<{ where: Readonly<Record<string, unknown>>; limit: number }> = [];
  const read = async (where: Readonly<Record<string, unknown>>, limit: number): Promise<Row[]> => {
    asked.push({ where, limit });
    return rows.filter((row) => !('slug' in where) || row.slug === where.slug).slice(0, limit);
  };
  return { read, asked };
}

describe('[ADR-0131 D3/D5] findDefaultOrganization — the one definition', () => {
  it('the organization slugged `default` wins, beside others, and the second read is never issued', async () => {
    const { read, asked } = readOver([{ id: 'org_acme', slug: 'acme' }, { id: 'org_def', slug: 'default' }]);
    expect(await findDefaultOrganization(read)).toEqual({ id: 'org_def', row: { id: 'org_def', slug: 'default' }, several: false });
    expect(asked).toEqual([{ where: { slug: DEFAULT_ORGANIZATION_SLUG }, limit: 1 }]);
  });

  it('else the only organization, whatever its slug', async () => {
    const { read, asked } = readOver([{ id: 'org_acme', slug: 'acme' }]);
    expect(await findDefaultOrganization(read)).toMatchObject({ id: 'org_acme', several: false });
    expect(asked).toEqual([{ where: { slug: 'default' }, limit: 1 }, { where: {}, limit: 2 }]);
  });

  it('several, none of them `default`, name none — and say so', async () => {
    const { read } = readOver([{ id: 'org_a', slug: 'a' }, { id: 'org_b', slug: 'b' }]);
    expect(await findDefaultOrganization(read)).toEqual({ id: undefined, row: undefined, several: true });
  });

  it('no organization names none, and is not "several"', async () => {
    const { read } = readOver([]);
    expect(await findDefaultOrganization(read)).toEqual({ id: undefined, row: undefined, several: false });
  });

  it('a row with no usable id names nothing: a blank-id `default` falls through to the only-organization reading', async () => {
    expect((await findDefaultOrganization(readOver([{ id: '', slug: 'default' }]).read)).id).toBeUndefined();
    expect((await findDefaultOrganization(readOver([{ id: null, slug: 'default' }, { id: 'org_b', slug: 'b' }]).read)).id)
      .toBeUndefined();
  });

  it('a read that fails propagates: what an unreadable store means is the caller\'s read policy', async () => {
    const boom = new Error('store unreachable');
    await expect(findDefaultOrganization(async () => { throw boom; })).rejects.toBe(boom);
  });
});

describe('[ADR-0131 D5] readDefaultOrganizationId — the resolver\'s read over the one definition', () => {
  const engineOver = (rows: Row[], registered = true) => ({
    registry: { getObject: (name: string) => (registered && name === 'sys_organization' ? { name } : undefined) },
    async find(_object: string, query: { where?: Record<string, unknown>; limit?: number }) {
      return readOver(rows).read(query.where ?? {}, query.limit ?? 100);
    },
  });

  it('answers what the definition answers', async () => {
    expect(await readDefaultOrganizationId(engineOver([{ id: 'org_acme', slug: 'acme' }]))).toBe('org_acme');
    expect(await readDefaultOrganizationId(engineOver([{ id: 'org_acme', slug: 'acme' }, { id: 'org_b', slug: 'b' }]))).toBeUndefined();
  });

  it('a composition that registers no organization object holds none, and is not read', async () => {
    expect(await readDefaultOrganizationId(engineOver([{ id: 'org_acme', slug: 'acme' }], false))).toBeUndefined();
  });
});
