// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0048 addendum §A.2 Phase A1 — `namespace` travels on the publish payload.
 *
 * The publish-time namespace exclusivity gate (Phase A2, enterprise-side) is
 * keyed on the bare namespace (D1) and can check nothing unless the namespace
 * leaves the artifact. These are the acceptance-face pins for the open side of
 * that contract: the field exists on both schemas, it is OPTIONAL (§A.2's
 * algorithm opens with `if (namespace is absent) -> allow`), and it judges
 * values exactly as `manifest.namespace` does (§A.7 "two gates, one
 * vocabulary").
 *
 * `TemplateManifestSchema` re-declares the key as a SCAFFOLD-ONLY extra
 * (#6861, ADR-0049 enforce leg): the on-disk `objectstack.manifest.json`
 * really carries it — written by the template author, rewritten by
 * `create-objectstack`, read back by `readTemplateNamespace` — so the schema
 * that claims to describe that file declares it instead of silently stripping
 * it. It shares this vocabulary and is NOT a second publish surface; the pins
 * below hold both halves of that split.
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
  // The literal value the bundled blank template ships in
  // `packages/create-objectstack/src/templates/blank/objectstack.manifest.json`
  // — the scaffold surface's only in-repo instance (#6861).
  ['blank', true],
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
    // The scaffold surface is a different MEANING but the same VOCABULARY
    // (#6861) — a value legal on one side must be legal on the other, or
    // `create-objectstack` could stamp a namespace publish would later refuse.
    const templateField = TemplateManifestSchema.shape.namespace;

    const verdicts = NAMESPACE_CASES.map(([value, expected]) => ({
      value,
      expected,
      manifest: manifestField.safeParse(value).success,
      payload: payloadField.safeParse(value).success,
      request: requestField.safeParse(value).success,
      template: templateField.safeParse(value).success,
    }));

    // One assertion over the whole table so a drift names the offending value.
    expect(verdicts.filter((v) =>
      v.manifest !== v.expected || v.payload !== v.expected
      || v.request !== v.expected || v.template !== v.expected,
    )).toEqual([]);
  });

  it('every field is optional, so "absent" means the same thing on all sides', () => {
    expect(ManifestSchema.shape.namespace.safeParse(undefined).success).toBe(true);
    expect(PackageSchema.shape.namespace.safeParse(undefined).success).toBe(true);
    expect(CreatePackageRequestSchema.shape.namespace.safeParse(undefined).success).toBe(true);
    expect(TemplateManifestSchema.shape.namespace.safeParse(undefined).success).toBe(true);
  });
});

describe('TemplateManifestSchema declares namespace as a scaffold-only extra (#6861)', () => {
  /** A template manifest that is valid except for whatever a case changes. */
  function templateManifest(overrides: Record<string, unknown> = {}) {
    return {
      manifestId: 'com.acme.blank',
      displayName: 'Blank Starter',
      name: 'blank',
      specVersion: '^6.0.0',
      ...overrides,
    };
  }

  it('declares the field, alongside the rest of the create-request projection', () => {
    expect(Object.keys(TemplateManifestSchema.shape)).toContain('namespace');
    expect(Object.keys(TemplateManifestSchema.shape)).toContain('manifestId');
  });

  it('SURVIVES the parse — the key is no longer silently stripped', () => {
    // The pin this issue exists for. Before `namespace` was declared, this
    // schema's default strip mode dropped a key the scaffolder writes, rewrites
    // and reads back: `parse()` succeeded and answered without it.
    const parsed = TemplateManifestSchema.parse(templateManifest({ namespace: 'blank' }));
    expect('namespace' in parsed).toBe(true);
    expect(parsed.namespace).toBe('blank');
  });

  it('is OPTIONAL — a template-registry manifest declaring none still parses', () => {
    // The remote-template shape (#4902): no namespace anywhere on the file, and
    // `readTemplateNamespace` correctly yields undefined for it.
    const parsed = TemplateManifestSchema.parse(templateManifest());
    expect(parsed.namespace).toBeUndefined();
  });

  it('REJECTS a malformed namespace with the shared coded issue at the namespace path', () => {
    // The enforce half of ADR-0049: before the declaration a bad value parsed
    // green (stripped), so the schema had no opinion on a key it described.
    const result = TemplateManifestSchema.safeParse(templateManifest({ namespace: 'CRM-App' }));
    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues;
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('invalid_format');
    expect(issues[0].path).toEqual(['namespace']);
    expect(issues[0].message).toBe(
      'Namespace must be 2-20 chars, lowercase alphanumeric + underscore',
    );
  });

  it('says scaffold-only in its describe, and is NOT the publish field', () => {
    // Two distinct schema instances carrying two distinct meanings. Collapsing
    // them — by dropping the `.omit()` and inheriting the create-request field —
    // would make this on-disk file a second way to reserve a namespace, which
    // is exactly what the ADR-0048 addendum (§A.2 / §A.7) rules out.
    const templateField = TemplateManifestSchema.shape.namespace;
    const publishField = CreatePackageRequestSchema.shape.namespace;
    expect(templateField).not.toBe(publishField);

    const templateDoc = templateField.description ?? '';
    expect(templateDoc).toMatch(/scaffold-only/i);
    expect(templateDoc).toMatch(/NOT the publish namespace/i);

    // …and the publish field's own description is untouched by that split.
    expect(publishField.description).toBe(
      'Metadata namespace claimed by the package (mirrors manifest.namespace; e.g. "crm" → object names "crm_account")',
    );
  });
});
