// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15813] `TenantLayer0VerdictSchema` — the shape the enforcement layer
 * records on an operation and a producer reads back.
 *
 * The reader's safety rests on one property: anything that is NOT one of the
 * four verdicts fails to parse, so junk can only ever read as "no verdict" and
 * never as an organization. These pins hold the schema to that: every accepted
 * shape, and every refusal a reader relies on.
 */

import { describe, it, expect } from 'vitest';
import { TenantLayer0VerdictSchema } from './tenant-layer0-verdict';

describe('[#15813] TenantLayer0VerdictSchema — the four verdicts', () => {
  it.each([
    ['none', { kind: 'none' }],
    ['organization', { kind: 'organization', organizationId: 'org_acme' }],
    ['organizations (one member)', { kind: 'organizations', organizationIds: ['org_plant_a'] }],
    ['organizations (several)', { kind: 'organizations', organizationIds: ['org_plant_a', 'org_plant_b'] }],
    ['deny', { kind: 'deny' }],
  ])('accepts %s', (_label, value) => {
    const parsed = TenantLayer0VerdictSchema.safeParse(value);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(value);
  });
});

describe('[#15813] TenantLayer0VerdictSchema — junk is refused, never read as an organization', () => {
  it.each([
    ['an unknown kind', { kind: 'organisation', organizationId: 'org_acme' }],
    ['an empty organization id', { kind: 'organization', organizationId: '' }],
    ['a non-string organization id', { kind: 'organization', organizationId: 42 }],
    ['an empty set', { kind: 'organizations', organizationIds: [] }],
    ['a set with a duplicate', { kind: 'organizations', organizationIds: ['org_a', 'org_a'] }],
    ['a set with an empty member', { kind: 'organizations', organizationIds: ['org_a', ''] }],
    ['a set carried as a string', { kind: 'organizations', organizationIds: 'org_a' }],
    ['an extra key (strict)', { kind: 'none', organizationId: 'org_acme' }],
    ['`organization` carrying a set as well', { kind: 'organization', organizationId: 'org_a', organizationIds: ['org_a'] }],
    ['a bare string', 'org_acme'],
    ['null', null],
    ['undefined', undefined],
    ['a filter shape (the wall\'s OUTPUT, not its verdict)', { organization_id: 'org_acme' }],
  ])('refuses %s', (_label, value) => {
    expect(TenantLayer0VerdictSchema.safeParse(value).success).toBe(false);
  });
});
