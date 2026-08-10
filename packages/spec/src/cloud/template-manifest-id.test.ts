// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `manifestId` is OPTIONAL on the on-disk descriptor and REQUIRED on the
 * publish request (#7319).
 *
 * `TemplateManifestSchema` is a projection of `CreatePackageRequestSchema`, and
 * it inherited `manifestId` as required — so the bundled blank template did not
 * satisfy the `$schema` it declares, with `manifestId` the only complaint
 * (measured on `origin/main` @ 3e8e669c0). Nothing broke, because nothing parses
 * the file: `objectstack package publish` reads it as raw JSON and resolves
 * `--manifest-id ?? m.manifestId ?? deriveManifestId(...)`, which is also the
 * measurement that the key is genuinely optional on this side.
 *
 * The fix is a LOCAL relaxation, and these pins hold both halves of it. Widening
 * the shared base instead would have made the publish request accept a package
 * with no identity — the same "one schema, two meanings" collapse the sibling
 * `namespace` split (#6861, `package-namespace.test.ts`) exists to prevent, in
 * the direction that costs more.
 */

import { describe, it, expect } from 'vitest';
import { CreatePackageRequestSchema } from './package.zod';
import { TemplateManifestSchema } from './template-manifest.zod';

/** A template manifest that is valid except for whatever a case changes. */
function templateManifest(overrides: Record<string, unknown> = {}) {
  return {
    name: 'blank',
    specVersion: '^6.0.0',
    displayName: 'Blank Starter',
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

describe('TemplateManifestSchema relaxes manifestId to optional (#7319)', () => {
  it('parses a manifest that declares no manifestId — the shipped shape', () => {
    const result = TemplateManifestSchema.safeParse(templateManifest());
    expect(result.success).toBe(true);
    expect(result.success && result.data.manifestId).toBeUndefined();
  });

  it('still DECLARES the key — relaxed, not stripped', () => {
    // A projection that dropped the field entirely would silently discard an id a
    // template author did write, which is #6861's failure wearing the other hat.
    expect(Object.keys(TemplateManifestSchema.shape)).toContain('manifestId');
    const parsed = TemplateManifestSchema.parse(templateManifest({ manifestId: 'com.acme.blank' }));
    expect(parsed.manifestId).toBe('com.acme.blank');
  });

  it('still JUDGES the value — optional is not unvalidated', () => {
    const result = TemplateManifestSchema.safeParse(templateManifest({ manifestId: 'Not A Reverse Domain' }));
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['manifestId']);
    expect(issues[0].code).toBe('invalid_format');
  });

  it('relaxes manifestId ONLY — the other required keys are untouched', () => {
    const result = TemplateManifestSchema.safeParse({ name: 'blank', specVersion: '^6.0.0' });
    expect(result.success).toBe(false);
    const paths = result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('displayName');
    expect(paths).not.toContain('manifestId');
  });
});

describe('CreatePackageRequestSchema keeps manifestId REQUIRED (#7319)', () => {
  it('rejects a publish request with no manifestId', () => {
    const { manifestId: _dropped, ...withoutId } = createRequest();
    const result = CreatePackageRequestSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toEqual(['manifestId']);
    expect(issues[0].code).toBe('invalid_type');
  });

  it('accepts one that carries it', () => {
    expect(CreatePackageRequestSchema.safeParse(createRequest()).success).toBe(true);
  });

  it('is a DIFFERENT field instance from the template one, and keeps its own describe', () => {
    // Two instances carrying two obligations. Collapsing them — by relaxing the
    // base instead of overriding locally — is the regression these pins exist for.
    const templateField = TemplateManifestSchema.shape.manifestId;
    const publishField = CreatePackageRequestSchema.shape.manifestId;
    expect(templateField).not.toBe(publishField);

    expect(publishField.safeParse(undefined).success).toBe(false);
    expect(templateField.safeParse(undefined).success).toBe(true);

    expect(publishField.description).toBe(
      'Globally unique reverse-domain package identifier (e.g. com.acme.crm)',
    );
    const templateDoc = templateField.description ?? '';
    expect(templateDoc).toMatch(/optional/i);
    expect(templateDoc).toMatch(/NOT optional on the publish request/i);
  });
});
