// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0048 addendum §A.2 Phase A1 — `namespace` travels on the publish payload.
 *
 * The publish-time namespace exclusivity gate (Phase A2, enterprise-side) is
 * keyed on the bare namespace (D1) and can check nothing unless the namespace
 * leaves the artifact. These are the acceptance-face pins for the open side of
 * that contract: the field exists on both schemas, it is OPTIONAL (§A.2's
 * algorithm opens with `if (namespace is absent) -> allow`), it judges values
 * exactly as `manifest.namespace` does (§A.7 "two gates, one vocabulary"), and
 * the on-disk template descriptor deliberately does NOT declare it.
 */

import { describe, it, expect } from 'vitest';
import { ManifestSchema } from '../kernel/manifest.zod';
import { CreatePackageRequestSchema, PackageSchema } from './package.zod';
import { TemplateManifestSchema } from './template-manifest.zod';

/** A Package row that is valid except for whatever the case under test changes. */
function packageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '3f1c2a52-6b0e-4a3f-9c1d-2e5b7a8d9f01',
    manifestId: 'com.acme.crm',
    ownerOrgId: 'org_acme',
    displayName: 'Acme CRM',
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
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

/**
 * The value table both gates are judged against. `true` = the string is a
 * legal namespace per `manifest.namespace`'s documented rule (2-20 chars,
 * leading lowercase letter, then lowercase letters / digits / underscores).
 */
const NAMESPACE_CASES: ReadonlyArray<readonly [string, boolean]> = [
  ['crm', true],
  ['todo', true],
  ['a1', true],
  ['my_app_2', true],
  ['base', true],       // shareable at the GATE (D3), still a well-formed string
  ['sys', true],
  ['abcdefghijklmnopqrst', true],   // 20 chars — the upper bound
  ['a', false],                     // 1 char — under the lower bound
  ['abcdefghijklmnopqrstu', false],  // 21 chars — over the upper bound
  ['1crm', false],                  // leading digit
  ['CRM', false],                   // uppercase
  ['crm-app', false],               // hyphen
  ['crm account', false],           // space
  ['crm.account', false],           // dot (that is manifest_id's alphabet)
  ['', false],
];

describe('PackageSchema.namespace (ADR-0048 addendum Phase A1)', () => {
  it('declares the field and accepts a well-formed namespace', () => {
    const parsed = PackageSchema.parse(packageRow({ namespace: 'crm' }));
    expect(parsed.namespace).toBe('crm');
  });

  it('is OPTIONAL — a row with no namespace parses and carries none', () => {
    const parsed = PackageSchema.parse(packageRow());
    expect(parsed.namespace).toBeUndefined();
    expect('namespace' in parsed).toBe(false);
  });

  it('rejects a malformed namespace with a coded issue AT the namespace path', () => {
    const result = PackageSchema.safeParse(packageRow({ namespace: 'CRM-App' }));
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('invalid_format');
    expect(issues[0].path).toEqual(['namespace']);
    expect(issues[0].message).toBe(
      'Namespace must be 2-20 chars, lowercase alphanumeric + underscore',
    );
  });

  it('rejects a non-string namespace with invalid_type at the namespace path', () => {
    const result = PackageSchema.safeParse(packageRow({ namespace: 42 }));
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues[0].code).toBe('invalid_type');
    expect(issues[0].path).toEqual(['namespace']);
  });
});

describe('CreatePackageRequestSchema.namespace (the publish payload)', () => {
  it('accepts a namespace on the publish request', () => {
    const parsed = CreatePackageRequestSchema.parse(createRequest({ namespace: 'crm' }));
    expect(parsed.namespace).toBe('crm');
  });

  it('is OPTIONAL — §A.2 allows a publish that declares no namespace', () => {
    const parsed = CreatePackageRequestSchema.parse(createRequest());
    expect(parsed.namespace).toBeUndefined();
  });

  it('rejects a malformed namespace with a coded issue at the namespace path', () => {
    const result = CreatePackageRequestSchema.safeParse(createRequest({ namespace: '1crm' }));
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('invalid_format');
    expect(issues[0].path).toEqual(['namespace']);
  });
});

describe('two gates, one vocabulary (§A.7)', () => {
  it('the publish payload judges every namespace exactly as manifest.namespace does', () => {
    const manifestField = ManifestSchema.shape.namespace;
    const payloadField = PackageSchema.shape.namespace;
    const requestField = CreatePackageRequestSchema.shape.namespace;

    const verdicts = NAMESPACE_CASES.map(([value, expected]) => ({
      value,
      expected,
      manifest: manifestField.safeParse(value).success,
      payload: payloadField.safeParse(value).success,
      request: requestField.safeParse(value).success,
    }));

    // One assertion over the whole table so a drift names the offending value.
    expect(verdicts.filter((v) =>
      v.manifest !== v.expected || v.payload !== v.expected || v.request !== v.expected,
    )).toEqual([]);
  });

  it('both fields are optional, so "absent" means the same thing on both sides', () => {
    expect(ManifestSchema.shape.namespace.safeParse(undefined).success).toBe(true);
    expect(PackageSchema.shape.namespace.safeParse(undefined).success).toBe(true);
    expect(CreatePackageRequestSchema.shape.namespace.safeParse(undefined).success).toBe(true);
  });
});

describe('TemplateManifestSchema does not inherit namespace', () => {
  it('omits it deliberately — the publish namespace comes from the compiled artifact', () => {
    expect(Object.keys(TemplateManifestSchema.shape)).not.toContain('namespace');
    // And the projection still carries the rest of the create-request surface.
    expect(Object.keys(TemplateManifestSchema.shape)).toContain('manifestId');
  });
});
