// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { resolvePublicFormOrganization } from './public-form-organization.js';
import * as securityEntry from './index.js';

// ADR-0138 D5: the organization a public form request acts in. The doors answer
// every `refuse` as an unpublished form; what is pinned here is the decision.

const ORGS: Record<string, string[]> = { acme: ['org_acme'], globex: ['org_globex'], initech: ['org_initech'] };

function probeCounting() {
  const asked: string[] = [];
  return {
    asked,
    probe: async (slug: string) => { asked.push(slug); return ORGS[slug] ?? []; },
  };
}

describe('resolvePublicFormOrganization', () => {
  it('is exported from the security entry as the same binding', () => {
    expect(securityEntry.resolvePublicFormOrganization).toBe(resolvePublicFormOrganization);
  });

  it('unbound form, link naming none: unbound (ADR-0138 D4 decides), nothing read', async () => {
    const { asked, probe } = probeCounting();
    expect(await resolvePublicFormOrganization({ published: [], requested: undefined, probeOrganizationsBySlug: probe }))
      .toEqual({ kind: 'unbound' });
    expect(asked).toEqual([]);
  });

  it.each(['acme', 'globex'])('bound form, link naming listed `%s`: that organization and only it', async (slug) => {
    const { asked, probe } = probeCounting();
    expect(await resolvePublicFormOrganization({ published: ['acme', 'globex'], requested: slug, probeOrganizationsBySlug: probe }))
      .toEqual({ kind: 'bound', organization: slug, organizationId: ORGS[slug][0] });
    expect(asked).toEqual([slug]);
  });

  it.each<[string, readonly string[], unknown, string]>([
    // ⛔ never the default organization, never the first listed one.
    ['bound form, link naming none', ['acme', 'globex'], undefined, 'organization-required'],
    ['bound form of one organization, link naming none', ['acme'], undefined, 'organization-required'],
    ['bound form, link naming an existing organization it does not list', ['acme', 'globex'], 'initech', 'not-published'],
    ['unbound form, link naming an organization', [], 'acme', 'not-published'],
    ['a repeated parameter', ['acme'], ['acme', 'acme'], 'malformed-organization'],
    ['an empty parameter', ['acme'], '', 'malformed-organization'],
    ['a non-string parameter', ['acme'], { slug: 'acme' }, 'malformed-organization'],
  ])('%s: refused (%s), and the database is never asked', async (_label, published, requested, reason) => {
    const { asked, probe } = probeCounting();
    expect(await resolvePublicFormOrganization({ published, requested, probeOrganizationsBySlug: probe }))
      .toEqual({ kind: 'refuse', reason });
    expect(asked).toEqual([]);
  });

  it('a listed slug that no organization carries: refused (unknown-organization)', async () => {
    const { asked, probe } = probeCounting();
    expect(await resolvePublicFormOrganization({ published: ['acme', 'ghost'], requested: 'ghost', probeOrganizationsBySlug: probe }))
      .toEqual({ kind: 'refuse', reason: 'unknown-organization' });
    expect(asked).toEqual(['ghost']);
  });

  it('a listed slug two organizations carry (a broken uniqueness invariant): refused, never a pick', async () => {
    expect(await resolvePublicFormOrganization({
      published: ['acme'],
      requested: 'acme',
      probeOrganizationsBySlug: async () => ['org_a', 'org_b'],
    })).toEqual({ kind: 'refuse', reason: 'unknown-organization' });
  });

  it('the slug match is exact: a case variant of a listed slug is not listed', async () => {
    const { asked, probe } = probeCounting();
    expect(await resolvePublicFormOrganization({ published: ['acme'], requested: 'ACME', probeOrganizationsBySlug: probe }))
      .toEqual({ kind: 'refuse', reason: 'not-published' });
    expect(asked).toEqual([]);
  });

  it('a failed organization read propagates (fail closed), never read as "no organization"', async () => {
    const outage = new Error('pool exhausted');
    await expect(resolvePublicFormOrganization({
      published: ['acme'],
      requested: 'acme',
      probeOrganizationsBySlug: async () => { throw outage; },
    })).rejects.toBe(outage);
  });
});
