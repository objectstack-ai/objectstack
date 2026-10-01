// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `PackageSchema.visibility` defaults to `org` (ADR-0006 v4 open question 2).
 *
 * The declared default used to be `private`, while every path that creates a
 * package reached `org` instead: the cloud control plane defaults an absent
 * `visibility` to `org`, and the CLI either sent `org` itself or, for
 * `os plugin publish`, its own `private`. The declaration was inert. The ruled
 * create-time default is `org`, so the schema now declares what the runtime
 * does.
 *
 * Two halves are pinned here:
 *  - the row schema fills an omitted `visibility` with `org`, and keeps every
 *    explicit value as written;
 *  - the CREATE request keeps `visibility` optional with NO default of its own,
 *    so a request that omits the key reaches the control plane without it and
 *    the control plane's default governs. A default on the request schema
 *    would put a value back on the wire that the CLI deliberately leaves off
 *    (a re-publish must not rewrite a stored visibility).
 */

import { describe, it, expect } from 'vitest';
import { CreatePackageRequestSchema, PackageSchema } from './package.zod';

/** A Package row that is valid except for whatever the case under test changes. */
function packageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '3f1c2a52-6b0e-4a3f-9c1d-2e5b7a8d9f01',
    manifestId: 'com.acme.crm',
    ownerOrgId: 'org_acme',
    displayName: 'Acme CRM',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    createdBy: 'usr_1',
    ...overrides,
  };
}

/** A CreatePackageRequest that is valid except for the case under test. */
function createRequest(overrides: Record<string, unknown> = {}) {
  return {
    manifestId: 'com.acme.crm',
    ownerOrgId: 'org_acme',
    displayName: 'Acme CRM',
    createdBy: 'usr_1',
    ...overrides,
  };
}

describe('PackageSchema.visibility — the create-time default is `org`', () => {
  it('fills an omitted visibility with `org`', () => {
    const row = packageRow();
    expect('visibility' in row).toBe(false);
    expect(PackageSchema.parse(row).visibility).toBe('org');
  });

  it.each(['private', 'org', 'marketplace'] as const)('keeps an explicit `%s` as written', (value) => {
    expect(PackageSchema.parse(packageRow({ visibility: value })).visibility).toBe(value);
  });

  it('still refuses a value outside the three', () => {
    const result = PackageSchema.safeParse(packageRow({ visibility: 'public' }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['visibility']);
  });
});

describe('CreatePackageRequestSchema.visibility — optional, with no default of its own', () => {
  it('leaves an omitted visibility absent, so the control plane decides', () => {
    const parsed = CreatePackageRequestSchema.parse(createRequest());
    expect('visibility' in parsed).toBe(false);
  });

  it.each(['private', 'org', 'marketplace'] as const)('carries an explicit `%s` through', (value) => {
    expect(CreatePackageRequestSchema.parse(createRequest({ visibility: value })).visibility).toBe(value);
  });
});
