// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  defineCapability,
  CapabilityDeclarationSchema,
  PLATFORM_CAPABILITIES,
  PLATFORM_CAPABILITY_NAMES,
} from './capabilities';

describe('defineCapability (ADR-0066 D1 package declaration)', () => {
  it('validates and returns a capability declaration with defaults applied', () => {
    const cap = defineCapability({
      name: 'export_data',
      label: 'Export Data',
      description: 'Bulk export to CSV.',
      scope: 'org',
    });
    expect(cap).toEqual({
      name: 'export_data',
      label: 'Export Data',
      description: 'Bulk export to CSV.',
      scope: 'org',
    });
  });

  it('defaults scope to platform when omitted', () => {
    const cap = defineCapability({ name: 'billing.refund', label: 'Refund' });
    expect(cap.scope).toBe('platform');
  });

  it('allows dotted and underscored lowercase names', () => {
    expect(() => defineCapability({ name: 'billing.refund' })).not.toThrow();
    expect(() => defineCapability({ name: 'export_data' })).not.toThrow();
  });

  it('rejects invalid (uppercase / spaced) names', () => {
    expect(() => defineCapability({ name: 'ExportData' })).toThrow();
    expect(() => defineCapability({ name: 'export data' })).toThrow();
    expect(() => defineCapability({ name: '' })).toThrow();
  });

  it('carries an optional author-declared packageId', () => {
    const cap = defineCapability({ name: 'x_cap', packageId: 'com.acme.x' });
    expect(cap.packageId).toBe('com.acme.x');
  });

  it('is the declaration counterpart of the curated platform set', () => {
    // Every curated platform capability is a valid declaration shape.
    for (const c of PLATFORM_CAPABILITIES) {
      const parsed = CapabilityDeclarationSchema.parse(c);
      expect(parsed.name).toBe(c.name);
      expect(PLATFORM_CAPABILITY_NAMES.has(parsed.name)).toBe(true);
    }
  });
});

describe('ADR-0131 D6 — `manage_org_presentation` retired', () => {
  it('is no longer a curated platform capability', () => {
    expect(PLATFORM_CAPABILITY_NAMES.has('manage_org_presentation')).toBe(false);
    expect(PLATFORM_CAPABILITIES.some((c) => c.name === 'manage_org_presentation')).toBe(false);
    // Control: its platform-wide sibling stays.
    expect(PLATFORM_CAPABILITY_NAMES.has('manage_metadata')).toBe(true);
  });
});
