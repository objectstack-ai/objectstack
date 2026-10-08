// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12699 / ADR-0131 D7] The ONE reader of the mounted `org-scoping` service's
 * per-deployment keys. Its rules stand as #12699 set them: absent key ⇒ nothing
 * declared; junk ⇒ the WHOLE key refused (no object declared, no partial
 * honouring), each key independently, never coerced.
 *
 * The cases moved here with the reader: they used to run through
 * plugin-security's Layer 0 stand-down, which ADR-0131 D7 retired. The engine's
 * schema registry is now the `platformGlobalObjects` consumer and
 * plugin-security the `suppressUnboundedOrgAdminGrant` one; both read this.
 */

import { describe, expect, it } from 'vitest';
import { readDeploymentOrgScopingEntitlement } from './deployment-org-scoping-entitlement.js';

describe('readDeploymentOrgScopingEntitlement', () => {
  it.each([
    ['no service', undefined],
    ['a null service', null],
    ['a non-object service', 'org-scoping'],
    ['a service declaring neither key', { name: 'com.example.org-scoping', supportedPostures: ['isolated'] }],
  ])('%s ⇒ nothing declared, nothing refused', (_label, service) => {
    const reading = readDeploymentOrgScopingEntitlement(service);
    expect([...reading.platformGlobalObjects]).toEqual([]);
    expect(reading.suppressUnboundedOrgAdminGrant).toBe(false);
    expect(reading.refused).toEqual([]);
  });

  it('a well-formed declaration is read as declared', () => {
    const reading = readDeploymentOrgScopingEntitlement({
      platformGlobalObjects: ['sys_setting', 'sys_job'],
      suppressUnboundedOrgAdminGrant: true,
    });
    expect([...reading.platformGlobalObjects].sort()).toEqual(['sys_job', 'sys_setting']);
    expect(reading.suppressUnboundedOrgAdminGrant).toBe(true);
    expect(reading.refused).toEqual([]);
  });

  it.each([
    ['a bare string', 'sys_widget_registry'],
    ['a wildcard entry beside a valid one', ['sys_widget_registry', '*']],
    ['an empty-string entry', ['sys_widget_registry', '']],
    ['a number', 42],
  ])('junk platformGlobalObjects (%s) ⇒ the WHOLE key refused, no object declared', (_label, value) => {
    const reading = readDeploymentOrgScopingEntitlement({ platformGlobalObjects: value });
    expect([...reading.platformGlobalObjects]).toEqual([]);
    expect(reading.refused.map((r) => r.key)).toEqual(['platformGlobalObjects']);
    expect(reading.refused[0]?.value).toEqual(value);
  });

  it('junk in one key does not void the other (each key fails closed independently)', () => {
    const reading = readDeploymentOrgScopingEntitlement({
      platformGlobalObjects: ['sys_widget_registry'],
      suppressUnboundedOrgAdminGrant: 'yes',
    });
    expect([...reading.platformGlobalObjects]).toEqual(['sys_widget_registry']);
    expect(reading.suppressUnboundedOrgAdminGrant).toBe(false);
    expect(reading.refused.map((r) => r.key)).toEqual(['suppressUnboundedOrgAdminGrant']);
  });

  it('memoizes per service instance; a new instance re-validates', () => {
    const service = { platformGlobalObjects: ['sys_widget_registry'] };
    expect(readDeploymentOrgScopingEntitlement(service)).toBe(readDeploymentOrgScopingEntitlement(service));
    const other = { platformGlobalObjects: ['sys_widget_registry'] };
    expect(readDeploymentOrgScopingEntitlement(other)).not.toBe(readDeploymentOrgScopingEntitlement(service));
  });
});
