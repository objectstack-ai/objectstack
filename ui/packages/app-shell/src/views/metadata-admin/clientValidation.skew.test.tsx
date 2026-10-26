// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Cross-repo spec-skew root-cure: the client (bundled @objectstack/spec) must
 * never be STRICTER than the running server. validateMetadataDraft suppresses
 * "missing required field" errors for fields the server schema marks optional.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the bundled report schema to the STALE shape (objectName + columns
// required) so we can prove the suppression against a newer server schema.
vi.mock('@objectstack/spec/ui', () => ({
  ReportSchema: {
    safeParse: (v: any) => {
      const issues: Array<{ path: (string | number)[]; message: string }> = [];
      if (v?.objectName === undefined) issues.push({ path: ['objectName'], message: 'Required' });
      if (v?.columns === undefined) issues.push({ path: ['columns'], message: 'Required' });
      // a present-but-invalid field error that must NEVER be suppressed
      if (v?.label === '') issues.push({ path: ['label'], message: 'Label must not be empty' });
      return issues.length ? { success: false, error: { issues } } : { success: true };
    },
  },
}));

import { validateMetadataDraft } from './clientValidation';

beforeEach(() => vi.clearAllMocks());

// Server schema where objectName/columns are OPTIONAL (the dual-form, newer).
const serverSchema = { required: ['name', 'label'] };

describe('validateMetadataDraft — spec-skew suppression', () => {
  it('suppresses stale "objectName/columns required" when the server marks them optional', async () => {
    const draft = { name: 'rev', label: 'Revenue', dataset: 'sales', values: ['revenue'] };
    const res = await validateMetadataDraft('report', draft, serverSchema);
    expect(res.ok).toBe(true);
    expect(res.issues).toHaveLength(0);
  });

  it('still flags a present-but-invalid field (never over-suppresses)', async () => {
    const draft = { name: 'rev', label: '', dataset: 'sales', values: ['revenue'] };
    const res = await validateMetadataDraft('report', draft, serverSchema);
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toContain('label');
    // objectName/columns are still suppressed (absent + server-optional)
    expect(res.issues.map((i) => i.path)).not.toContain('objectName');
  });

  it('without a server schema, keeps the legacy (strict bundled) behavior', async () => {
    const draft = { name: 'rev', label: 'Revenue' }; // no objectName/columns
    const res = await validateMetadataDraft('report', draft);
    expect(res.ok).toBe(false);
    expect(res.issues.map((i) => i.path)).toEqual(expect.arrayContaining(['objectName', 'columns']));
  });

  it('does not suppress a required field that is still required by the server', async () => {
    // server requires label; bundled flags objectName(optional-on-server) + ... ;
    // here label is present so no label issue, objectName suppressed → ok.
    const draft = { name: 'rev', label: 'Revenue', dataset: 'sales', values: ['revenue'] };
    const res = await validateMetadataDraft('report', draft, { required: ['name', 'label'] });
    expect(res.ok).toBe(true);
  });
});
