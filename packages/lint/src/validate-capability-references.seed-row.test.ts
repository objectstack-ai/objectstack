// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { validateCapabilityReferences, CAPABILITY_REFERENCE_UNKNOWN } from './validate-capability-references.js';

// [ADR-0131 D3, C3 stage 8] A `sys_capability` seed row declares nothing: no
// runtime reader consults one, and the row object is retired. Counting it as a
// source silenced this warning for a capability the runtime never declares,
// while the `requiredPermissions` gate it names failed closed.
describe('capability-reference-unknown — a seed row is no source', () => {
  it('still warns on a capability only a sys_capability seed row ships', () => {
    const findings = validateCapabilityReferences({
      data: [{ object: 'sys_capability', records: [{ name: 'approve_invoice' }] }],
      objects: [{ name: 'inv_invoice', requiredPermissions: ['approve_invoice'] }],
    });
    expect(findings.map((f) => f.rule)).toEqual([CAPABILITY_REFERENCE_UNKNOWN]);
    expect(findings[0].hint).not.toContain('seed row');
  });

  it('CONTROL: the same capability declared with defineCapability is known', () => {
    const findings = validateCapabilityReferences({
      capabilities: [{ name: 'approve_invoice', label: 'Approve', scope: 'org' }],
      objects: [{ name: 'inv_invoice', requiredPermissions: ['approve_invoice'] }],
    });
    expect(findings).toEqual([]);
  });
});
