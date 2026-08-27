// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// [#11965 / #11663 Choice 6A] platform-admin re-anchor L1 — the kernel
// platform-admin capability declaration is exported from the contract package.

import { describe, it, expect } from 'vitest';
import { ADMIN_FULL_ACCESS, ADMIN_FULL_ACCESS_CAPABILITIES } from './eval-user.zod';
import { PermissionSetSchema } from '../security/permission.zod';
import { PLATFORM_CAPABILITY_NAMES } from '../security/capabilities';

describe('ADMIN_FULL_ACCESS_CAPABILITIES (#11965, Choice 6A)', () => {
  it('carries exactly the two capability-bearing fields — name/label stay with the declaring package', () => {
    // The export is the capability CONTENT, not a permission set. `name` /
    // `label` (or any other authored field) creeping in here would make the
    // spec copy a second declaration instead of the single shared list.
    expect(Object.keys(ADMIN_FULL_ACCESS_CAPABILITIES).sort()).toEqual([
      'objects',
      'systemPermissions',
    ]);
  });

  it('composes into a valid strict permission-set declaration under the canonical name', () => {
    // Exactly how plugin-security consumes it: spread into the authored shape.
    const parsed = PermissionSetSchema.parse({
      name: ADMIN_FULL_ACCESS,
      label: 'Administrator — Full Access',
      ...ADMIN_FULL_ACCESS_CAPABILITIES,
    });
    expect(parsed.name).toBe('admin_full_access');
    // The PLATFORM_ADMIN posture rung derives from these bits (ADR-0095 D3).
    expect(parsed.objects['*'].viewAllRecords).toBe(true);
    expect(parsed.objects['*'].modifyAllRecords).toBe(true);
  });

  it('the wildcard grants NO export — #8681 ruling pinned at the declaration\'s new home', () => {
    // [#3544/#8681] export is an OPT-IN axis, deliberately absent from the
    // super-user wildcard (maintainer ruling 2026-08-15). Moving the
    // declaration into spec must not resurrect it.
    expect('allowExport' in ADMIN_FULL_ACCESS_CAPABILITIES.objects!['*']).toBe(false);
    const parsed = PermissionSetSchema.parse({ name: ADMIN_FULL_ACCESS, ...ADMIN_FULL_ACCESS_CAPABILITIES });
    expect(parsed.objects['*'].allowExport).not.toBe(true);
  });

  it('every granted system permission is a declared built-in capability (ADR-0066 registry)', () => {
    const unknown = (ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions ?? []).filter(
      (name) => !PLATFORM_CAPABILITY_NAMES.has(name),
    );
    expect(unknown).toEqual([]);
  });
});
