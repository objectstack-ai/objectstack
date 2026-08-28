import { describe, it, expect } from 'vitest';
import {
  PackagePathParamsSchema,
  ListInstalledPackagesRequestSchema,
  ListInstalledPackagesResponseSchema,
  GetInstalledPackageRequestSchema,
  GetInstalledPackageResponseSchema,
  PackageInstallRequestSchema,
  PackageInstallResponseSchema,
  PackageUpgradeRequestSchema,
  PackageUpgradeResponseSchema,
  ResolveDependenciesRequestSchema,
  ResolveDependenciesResponseSchema,
  UploadArtifactRequestSchema,
  UploadArtifactResponseSchema,
  PackageRollbackRequestSchema,
  UninstallPackageApiRequestSchema,
  UninstallPackageApiResponseSchema,
  PackageApiErrorCode,
  PackageApiContracts,
} from './package-api.zod';

// ==========================================
// Path Parameters
// ==========================================

describe('PackagePathParamsSchema', () => {
  it('should accept a valid package ID', () => {
    const result = PackagePathParamsSchema.parse({ packageId: 'com.acme.crm' });
    expect(result.packageId).toBe('com.acme.crm');
  });
});

// ==========================================
// List Packages
// ==========================================

describe('ListInstalledPackagesRequestSchema', () => {
  it('should accept minimal request with defaults', () => {
    const result = ListInstalledPackagesRequestSchema.parse({});
    expect(result.limit).toBe(50);
    expect(result.status).toBeUndefined();
    expect(result.enabled).toBeUndefined();
  });

  it('should accept full request', () => {
    const result = ListInstalledPackagesRequestSchema.parse({
      status: 'installed',
      enabled: true,
      limit: 20,
      cursor: 'abc123',
    });
    expect(result.status).toBe('installed');
    expect(result.enabled).toBe(true);
    expect(result.limit).toBe(20);
    expect(result.cursor).toBe('abc123');
  });

  it('should reject invalid status', () => {
    expect(() => ListInstalledPackagesRequestSchema.parse({ status: 'running' })).toThrow();
  });
});

// ==========================================
// Install Package
// ==========================================

describe('PackageInstallRequestSchema', () => {
  it('should accept a minimal install request', () => {
    const result = PackageInstallRequestSchema.parse({
      manifest: {
        id: 'com.acme.crm',
        name: 'acme_crm',
        version: '1.0.0',
        type: 'plugin',
      },
    });
    expect(result.enableOnInstall).toBe(true);
  });

  it('should accept full install request with platform version', () => {
    const result = PackageInstallRequestSchema.parse({
      manifest: {
        id: 'com.acme.crm',
        name: 'acme_crm',
        version: '1.0.0',
        type: 'plugin',
      },
      settings: { apiKey: 'abc123' },
      enableOnInstall: false,
      platformVersion: '3.2.0',
      artifactRef: {
        url: 'https://marketplace.objectstack.io/artifacts/com.acme.crm/1.0.0.tgz',
        sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        size: 1024000,
        uploadedAt: '2026-02-01T10:00:00Z',
      },
    });
    expect(result.enableOnInstall).toBe(false);
    expect(result.platformVersion).toBe('3.2.0');
    expect(result.artifactRef?.sha256).toBeDefined();
  });
});

describe('PackageInstallResponseSchema', () => {
  it('should accept a successful install response', () => {
    const result = PackageInstallResponseSchema.parse({
      success: true,
      data: {
        package: {
          manifest: { id: 'com.acme.crm', name: 'acme_crm', version: '1.0.0', type: 'plugin' },
          status: 'installed',
          enabled: true,
        },
        dependencyResolution: {
          dependencies: [
            { packageId: 'com.acme.core', requiredRange: '^1.0.0', status: 'satisfied', resolvedVersion: '1.2.0' },
          ],
          canProceed: true,
          requiredActions: [],
          installOrder: ['com.acme.core', 'com.acme.crm'],
        },
        message: 'Package installed successfully',
      },
    });
    expect(result.success).toBe(true);
    expect(result.data.package.status).toBe('installed');
    expect(result.data.dependencyResolution?.canProceed).toBe(true);
  });

  it('should accept install response with namespace conflicts', () => {
    const result = PackageInstallResponseSchema.parse({
      success: true,
      data: {
        package: {
          manifest: { id: 'com.acme.crm', name: 'acme_crm', version: '1.0.0', type: 'plugin' },
          status: 'installed',
          enabled: true,
        },
        namespaceConflicts: [{
          type: 'namespace_conflict',
          requestedNamespace: 'acme',
          conflictingPackageId: 'com.other.plugin',
          conflictingPackageName: 'Other Plugin',
          suggestion: 'acme_crm',
        }],
      },
    });
    expect(result.data.namespaceConflicts).toHaveLength(1);
    expect(result.data.namespaceConflicts![0].suggestion).toBe('acme_crm');
  });
});

// ==========================================
// Upgrade Package
// ==========================================

describe('PackageUpgradeRequestSchema', () => {
  it('should accept minimal upgrade request', () => {
    const result = PackageUpgradeRequestSchema.parse({
      packageId: 'com.acme.crm',
    });
    expect(result.packageId).toBe('com.acme.crm');
    expect(result.createSnapshot).toBe(true);
    expect(result.mergeStrategy).toBe('three-way-merge');
    expect(result.dryRun).toBe(false);
  });

  it('should accept full upgrade request', () => {
    const result = PackageUpgradeRequestSchema.parse({
      packageId: 'com.acme.crm',
      targetVersion: '2.0.0',
      manifest: { id: 'com.acme.crm', name: 'acme_crm', version: '2.0.0', type: 'plugin' },
      createSnapshot: true,
      mergeStrategy: 'keep-custom',
      dryRun: true,
      skipValidation: false,
    });
    expect(result.targetVersion).toBe('2.0.0');
    expect(result.mergeStrategy).toBe('keep-custom');
    expect(result.dryRun).toBe(true);
  });
});

describe('PackageUpgradeResponseSchema', () => {
  it('should accept a successful upgrade response', () => {
    const result = PackageUpgradeResponseSchema.parse({
      success: true,
      data: {
        success: true,
        phase: 'completed',
        snapshotId: 'snap_001',
        plan: {
          packageId: 'com.acme.crm',
          fromVersion: '1.0.0',
          toVersion: '2.0.0',
          impactLevel: 'medium',
          changes: [
            { type: 'object', name: 'account', changeType: 'modified', summary: 'Added fields' },
          ],
        },
        message: 'Upgrade completed successfully',
      },
    });
    expect(result.data.success).toBe(true);
    expect(result.data.phase).toBe('completed');
    expect(result.data.snapshotId).toBe('snap_001');
    expect(result.data.plan?.changes).toHaveLength(1);
  });

  it('should accept upgrade response with merge conflicts', () => {
    const result = PackageUpgradeResponseSchema.parse({
      success: true,
      data: {
        success: false,
        phase: 'failed',
        conflicts: [{
          path: 'objects/account/fields/status',
          baseValue: 'active',
          incomingValue: 'enabled',
          customValue: 'custom_active',
        }],
        errorMessage: 'Merge conflicts detected',
      },
    });
    expect(result.data.success).toBe(false);
    expect(result.data.conflicts).toHaveLength(1);
  });
});

// ==========================================
// Resolve Dependencies
// ==========================================

describe('ResolveDependenciesRequestSchema', () => {
  it('should accept a resolve request with manifest', () => {
    const result = ResolveDependenciesRequestSchema.parse({
      manifest: { id: 'com.acme.crm', name: 'acme_crm', version: '1.0.0', type: 'plugin' },
      platformVersion: '3.2.0',
    });
    expect(result.platformVersion).toBe('3.2.0');
  });
});

describe('ResolveDependenciesResponseSchema', () => {
  it('should accept a resolution response', () => {
    const result = ResolveDependenciesResponseSchema.parse({
      success: true,
      data: {
        dependencies: [
          { packageId: 'com.acme.core', requiredRange: '^2.0.0', resolvedVersion: '2.1.0', status: 'satisfied' },
          { packageId: 'com.acme.ui', requiredRange: '^1.5.0', resolvedVersion: '1.5.2', status: 'needs_install' },
        ],
        canProceed: true,
        requiredActions: [
          { type: 'install', packageId: 'com.acme.ui', description: 'Install com.acme.ui@1.5.2' },
        ],
        installOrder: ['com.acme.core', 'com.acme.ui', 'com.acme.crm'],
      },
    });
    expect(result.data.canProceed).toBe(true);
    expect(result.data.dependencies).toHaveLength(2);
    expect(result.data.installOrder).toHaveLength(3);
  });

  it('should accept resolution with circular dependencies', () => {
    const result = ResolveDependenciesResponseSchema.parse({
      success: true,
      data: {
        dependencies: [
          { packageId: 'A', requiredRange: '^1.0.0', status: 'conflict', conflictReason: 'Circular dependency' },
        ],
        canProceed: false,
        requiredActions: [
          { type: 'confirm_conflict', packageId: 'A', description: 'Circular dependency detected' },
        ],
        installOrder: [],
        circularDependencies: [['A', 'B', 'A']],
      },
    });
    expect(result.data.canProceed).toBe(false);
    expect(result.data.circularDependencies).toHaveLength(1);
  });
});

// ==========================================
// Upload Artifact
// ==========================================

describe('UploadArtifactRequestSchema', () => {
  it('should accept a valid upload request', () => {
    const result = UploadArtifactRequestSchema.parse({
      artifact: {
        packageId: 'com.acme.crm',
        version: '1.0.0',
        builtAt: '2026-02-01T10:00:00Z',
      },
      sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      releaseNotes: 'Initial release',
    });
    expect(result.artifact.packageId).toBe('com.acme.crm');
  });

  it('should reject invalid SHA256', () => {
    expect(() => UploadArtifactRequestSchema.parse({
      artifact: { packageId: 'test', version: '1.0.0', builtAt: '2026-02-01T10:00:00Z' },
      sha256: 'invalid-hash',
    })).toThrow();
  });
});

describe('UploadArtifactResponseSchema', () => {
  it('should accept a successful upload response', () => {
    const result = UploadArtifactResponseSchema.parse({
      success: true,
      data: {
        success: true,
        artifactRef: {
          url: 'https://marketplace.objectstack.io/artifacts/com.acme.crm/1.0.0.tgz',
          sha256: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          size: 1024000,
          uploadedAt: '2026-02-01T10:00:00Z',
        },
        submissionId: 'sub_001',
        message: 'Artifact uploaded successfully',
      },
    });
    expect(result.data.success).toBe(true);
    expect(result.data.artifactRef?.sha256).toBeDefined();
    expect(result.data.submissionId).toBe('sub_001');
  });
});

// ==========================================
// Rollback Package
// ==========================================

describe('PackageRollbackRequestSchema', () => {
  it('should accept a rollback request', () => {
    const result = PackageRollbackRequestSchema.parse({
      packageId: 'com.acme.crm',
      snapshotId: 'snap_001',
      rollbackCustomizations: true,
    });
    expect(result.packageId).toBe('com.acme.crm');
    expect(result.snapshotId).toBe('snap_001');
  });

  it('should default rollbackCustomizations to true', () => {
    const result = PackageRollbackRequestSchema.parse({
      packageId: 'com.acme.crm',
      snapshotId: 'snap_001',
    });
    expect(result.rollbackCustomizations).toBe(true);
  });
});

// `PackageRollbackResponseSchema` is RETIRED (#12038 3A) — it declared a
// VERSION rollback against the live COMMIT-rollback route. Its retirement pin
// (runtime namespace probes, the registry-retirement.test.ts pattern) lives in
// the `package-rollback-response retirement` block at the end of this file;
// the live route's true contract is covered in package-lifecycle.test.ts.

// ==========================================
// Uninstall Package
// ==========================================

describe('UninstallPackageApiResponseSchema', () => {
  it('should accept a successful uninstall response', () => {
    const result = UninstallPackageApiResponseSchema.parse({
      success: true,
      data: {
        packageId: 'com.acme.crm',
        success: true,
        message: 'Package uninstalled',
      },
    });
    expect(result.data.success).toBe(true);
    expect(result.data.packageId).toBe('com.acme.crm');
  });
});

// ==========================================
// Error Codes
// ==========================================

describe('PackageApiErrorCode', () => {
  it('should accept all valid error codes', () => {
    const validCodes = [
      'package_not_found', 'package_already_installed', 'version_not_found',
      'dependency_conflict', 'namespace_conflict', 'platform_incompatible',
      'artifact_invalid', 'checksum_mismatch', 'signature_invalid',
      'upgrade_failed', 'rollback_failed', 'snapshot_not_found', 'upload_failed',
    ];

    validCodes.forEach(code => {
      expect(PackageApiErrorCode.parse(code)).toBe(code);
    });
  });

  it('should reject invalid error code', () => {
    expect(() => PackageApiErrorCode.parse('unknown_error')).toThrow();
  });
});

// ==========================================
// API Contract Registry
// ==========================================

describe('PackageApiContracts', () => {
  it('should have all required endpoints', () => {
    expect(PackageApiContracts.listPackages).toBeDefined();
    expect(PackageApiContracts.getPackage).toBeDefined();
    expect(PackageApiContracts.installPackage).toBeDefined();
    expect(PackageApiContracts.upgradePackage).toBeDefined();
    expect(PackageApiContracts.resolveDependencies).toBeDefined();
    expect(PackageApiContracts.uploadArtifact).toBeDefined();
    expect(PackageApiContracts.uninstallPackage).toBeDefined();
  });

  it('should have correct HTTP methods', () => {
    expect(PackageApiContracts.listPackages.method).toBe('GET');
    expect(PackageApiContracts.getPackage.method).toBe('GET');
    expect(PackageApiContracts.installPackage.method).toBe('POST');
    expect(PackageApiContracts.upgradePackage.method).toBe('POST');
    expect(PackageApiContracts.resolveDependencies.method).toBe('POST');
    expect(PackageApiContracts.uploadArtifact.method).toBe('POST');
    expect(PackageApiContracts.uninstallPackage.method).toBe('DELETE');
  });

  it('should have correct paths', () => {
    expect(PackageApiContracts.listPackages.path).toBe('/api/v1/packages');
    expect(PackageApiContracts.getPackage.path).toBe('/api/v1/packages/:packageId');
    expect(PackageApiContracts.installPackage.path).toBe('/api/v1/packages/install');
    expect(PackageApiContracts.upgradePackage.path).toBe('/api/v1/packages/upgrade');
    expect(PackageApiContracts.resolveDependencies.path).toBe('/api/v1/packages/resolve-dependencies');
    expect(PackageApiContracts.uploadArtifact.path).toBe('/api/v1/packages/upload');
    expect(PackageApiContracts.uninstallPackage.path).toBe('/api/v1/packages/:packageId');
  });

  it('should have input and output schemas on all contracts', () => {
    Object.values(PackageApiContracts).forEach(contract => {
      expect(contract.input).toBeDefined();
      expect(contract.output).toBeDefined();
      expect(contract.method).toBeDefined();
      expect(contract.path).toBeDefined();
    });
  });
});

// ==========================================
// package-rollback-response retirement (#12038 3A)
// ==========================================

describe('package-rollback-response retirement (#12038 3A)', () => {
  // Runtime namespace probes, the registry-retirement.test.ts pattern: a
  // removed export cannot be imported by name (would not compile), so the pin
  // asks the namespace object. Anti-vacuity guard: a neighbour that stayed.
  it('`PackageRollbackResponseSchema` is no longer exported from `@objectstack/spec/api`', async () => {
    const api = await import('./index');
    const ns = api as unknown as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(ns, 'PackageRollbackResponseSchema')).toBe(false);
    // Anti-vacuity: the sibling that deliberately stayed still resolves.
    expect(Object.prototype.hasOwnProperty.call(ns, 'PackageRollbackRequestSchema')).toBe(true);
  });

  it('`PackageApiContracts` no longer binds any schema to the live commit-rollback path', () => {
    const entries = Object.entries(PackageApiContracts) as Array<[string, { path: string }]>;
    expect('rollbackPackage' in PackageApiContracts).toBe(false);
    // The load-bearing half: no contract-map entry claims the LIVE path the
    // dispatcher serves with `rollbackToPackageCommit` (#12038 §5.2 — the
    // retired entry bound the version-rollback schema to exactly this path).
    const claimants = entries.filter(([, c]) => c.path === '/api/v1/packages/:packageId/rollback');
    expect(claimants).toEqual([]);
    // Anti-vacuity: the map still carries its surviving entries.
    expect(entries.length).toBeGreaterThan(0);
  });
});
