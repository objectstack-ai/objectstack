// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0048 Phase 1 — install-time namespace gate.
 *
 * A package's `manifest.namespace` is the mandatory object-name prefix and the
 * container that scopes its UI metadata, so it must be unique per installation.
 * `installPackage` refuses a package whose namespace is already owned by a
 * *different* installed package. Same-package reinstall and shareable platform
 * namespaces (`base`/`system`/`sys`) pass through; `OS_METADATA_COLLISION=warn`
 * downgrades the refusal to a warning.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry, NamespaceConflictError } from './registry';

const manifest = (id: string, namespace: string) => ({
  id,
  name: id,
  namespace,
  version: '1.0.0',
});

describe('SchemaRegistry — namespace install gate (ADR-0048 Phase 1)', () => {
  let registry: SchemaRegistry;

  beforeEach(() => {
    registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    registry.logLevel = 'silent';
  });

  it('refuses a package whose namespace is already owned by a different package', () => {
    registry.installPackage(manifest('com.acme.crm', 'crm') as any);
    expect(() =>
      registry.installPackage(manifest('com.beta.crm', 'crm') as any),
    ).toThrowError(NamespaceConflictError);
  });

  it('error names both packages and the namespace', () => {
    registry.installPackage(manifest('com.acme.crm', 'crm') as any);
    try {
      registry.installPackage(manifest('com.beta.crm', 'crm') as any);
      throw new Error('expected a namespace conflict error');
    } catch (e) {
      expect(e).toBeInstanceOf(NamespaceConflictError);
      const err = e as NamespaceConflictError;
      expect(err.namespace).toBe('crm');
      expect(err.existingPackageId).toBe('com.acme.crm');
      expect(err.incomingPackageId).toBe('com.beta.crm');
      expect(err.message).toContain('com.acme.crm');
      expect(err.message).toContain('com.beta.crm');
      expect(err.message).toContain('crm');
    }
    // The conflicting package must NOT have been recorded.
    expect(registry.getPackage('com.beta.crm')).toBeUndefined();
    expect(registry.getNamespaceOwners('crm')).toEqual(['com.acme.crm']);
  });

  it('carries the ADR-0112 envelope: code NAMESPACE_CONFLICT + status 422', () => {
    // [#14474] The assertion the instance checks above cannot make, and the
    // reason this defect survived: `toThrowError(NamespaceConflictError)` and
    // `toBeInstanceOf(NamespaceConflictError)` are TRUE of a class carrying no
    // `code` and no `status`, so both stayed green while `POST /api/v1/packages`
    // answered this refusal as `500 INTERNAL_ERROR`. Measured on a booted stack
    // before the envelope landed; `422` with `declaredCode: NAMESPACE_CONFLICT`
    // after it. `resolveThrownHttpError` reads exactly these two fields off the
    // throw, so they are what the door's answer is MADE of — asserting the
    // class instead asserts something the wire never sees.
    registry.installPackage(manifest('com.acme.crm', 'crm') as any);
    let caught: (Error & { code?: string; status?: number }) | undefined;
    try {
      registry.installPackage(manifest('com.beta.crm', 'crm') as any);
    } catch (e) { caught = e as Error & { code?: string; status?: number }; }

    expect(caught?.code).toBe('NAMESPACE_CONFLICT');
    expect(caught?.status).toBe(422);
    // The prose is unchanged by the envelope — this card added fields, it did
    // not rewrite a sentence. Its first clause is what an operator reads.
    expect(caught?.message).toContain('Namespace conflict: namespace "crm"');
  });

  it('allows the same package to reinstall/reload its own namespace', () => {
    registry.installPackage(manifest('com.acme.crm', 'crm') as any);
    expect(() =>
      registry.installPackage(manifest('com.acme.crm', 'crm') as any),
    ).not.toThrow();
  });

  it('allows two packages with distinct namespaces', () => {
    registry.installPackage(manifest('com.acme.crm', 'crm') as any);
    expect(() =>
      registry.installPackage(manifest('com.acme.hr', 'hr') as any),
    ).not.toThrow();
  });

  it('exempts shareable platform namespaces (base/system/sys)', () => {
    for (const ns of ['base', 'system', 'sys']) {
      registry.installPackage(manifest(`com.a.${ns}`, ns) as any);
      expect(() =>
        registry.installPackage(manifest(`com.b.${ns}`, ns) as any),
      ).not.toThrow();
    }
  });

  it('downgrades to a warning under collisionPolicy "warn"', () => {
    const warnReg = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'warn' });
    warnReg.logLevel = 'silent';
    warnReg.installPackage(manifest('com.acme.crm', 'crm') as any);
    expect(() =>
      warnReg.installPackage(manifest('com.beta.crm', 'crm') as any),
    ).not.toThrow();
    // Both packages are recorded; the namespace now has two owners.
    expect(warnReg.getNamespaceOwners('crm').sort()).toEqual(['com.acme.crm', 'com.beta.crm']);
  });

  it('releases the namespace on uninstall, allowing a different package to claim it', () => {
    registry.installPackage(manifest('com.acme.crm', 'crm') as any);
    registry.uninstallPackage('com.acme.crm');
    expect(() =>
      registry.installPackage(manifest('com.beta.crm', 'crm') as any),
    ).not.toThrow();
    expect(registry.getNamespaceOwners('crm')).toEqual(['com.beta.crm']);
  });
});
