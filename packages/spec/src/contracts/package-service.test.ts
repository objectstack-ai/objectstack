import { describe, it, expect } from 'vitest';
import type {
  IPackageService,
  InstallPackageInput,
  InstallPackageResult,
  CheckNamespaceResult,
} from './package-service';
import type { InstalledPackage } from '../kernel/package-registry.zod';
import type { DependencyResolutionResult } from '../kernel/dependency-resolution.zod';
import type { UpgradePlan, UpgradePackageResponse, RollbackPackageResponse } from '../kernel/package-upgrade.zod';

describe('Package Service Contract', () => {
  it('should allow a minimal IPackageService implementation with required methods', () => {
    const service: IPackageService = {
      install: async () => ({ package: {} as InstalledPackage }),
      uninstall: async () => ({ success: true }),
      getPackage: async () => null,
      listPackages: async () => [],
      resolveDependencies: async () => ({
        dependencies: [],
        canProceed: true,
        requiredActions: [],
        installOrder: [],
      }),
      checkNamespaces: async () => ({ available: true, conflicts: [] }),
      planUpgrade: async () => ({
        packageId: 'com.acme.crm',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        impactLevel: 'low',
        changes: [],
      }),
      upgrade: async () => ({ success: true, phase: 'completed' }),
      rollback: async () => ({ success: true }),
    };

    expect(typeof service.install).toBe('function');
    expect(typeof service.uninstall).toBe('function');
    expect(typeof service.resolveDependencies).toBe('function');
    expect(typeof service.checkNamespaces).toBe('function');
    expect(typeof service.planUpgrade).toBe('function');
    expect(typeof service.upgrade).toBe('function');
    expect(typeof service.rollback).toBe('function');
  });

  it('should allow full implementation with optional methods', () => {
    const service: IPackageService = {
      install: async () => ({ package: {} as InstalledPackage }),
      uninstall: async () => ({ success: true }),
      getPackage: async () => null,
      listPackages: async () => [],
      resolveDependencies: async () => ({
        dependencies: [],
        canProceed: true,
        requiredActions: [],
        installOrder: [],
      }),
      checkNamespaces: async () => ({ available: true, conflicts: [] }),
      planUpgrade: async () => ({
        packageId: 'test',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        impactLevel: 'none',
        changes: [],
      }),
      upgrade: async () => ({ success: true, phase: 'completed' }),
      rollback: async () => ({ success: true }),
      getSnapshot: async () => null,
      uploadArtifact: async () => ({ success: true }),
      togglePackage: async () => ({} as InstalledPackage),
    };

    expect(service.getSnapshot).toBeDefined();
    expect(service.uploadArtifact).toBeDefined();
    expect(service.togglePackage).toBeDefined();
  });

  it('should install a package with dependency resolution', async () => {
    const service: IPackageService = {
      install: async (input): Promise<InstallPackageResult> => ({
        package: {
          manifest: input.manifest,
          status: 'installed',
          enabled: input.enableOnInstall !== false,
          installedVersion: input.manifest.version,
        } as InstalledPackage,
        dependencyResolution: {
          dependencies: [
            { packageId: 'com.acme.core', requiredRange: '^1.0.0', resolvedVersion: '1.2.0', status: 'satisfied' },
          ],
          canProceed: true,
          requiredActions: [],
          installOrder: ['com.acme.core', 'com.acme.crm'],
        },
        message: 'Package installed successfully',
      }),
      uninstall: async () => ({ success: true }),
      getPackage: async () => null,
      listPackages: async () => [],
      resolveDependencies: async () => ({ dependencies: [], canProceed: true, requiredActions: [], installOrder: [] }),
      checkNamespaces: async () => ({ available: true, conflicts: [] }),
      planUpgrade: async () => ({ packageId: '', fromVersion: '', toVersion: '', impactLevel: 'none', changes: [] }),
      upgrade: async () => ({ success: true, phase: 'completed' }),
      rollback: async () => ({ success: true }),
    };

    const result = await service.install({
      manifest: { id: 'com.acme.crm', name: 'acme_crm', version: '1.0.0' } as any,
      enableOnInstall: true,
      platformVersion: '3.2.0',
    });

    expect(result.package.status).toBe('installed');
    expect(result.dependencyResolution?.canProceed).toBe(true);
    expect(result.dependencyResolution?.installOrder).toContain('com.acme.crm');
    expect(result.message).toBe('Package installed successfully');
  });

  it('should detect namespace conflicts', async () => {
    const service: IPackageService = {
      install: async () => ({ package: {} as InstalledPackage }),
      uninstall: async () => ({ success: true }),
      getPackage: async () => null,
      listPackages: async () => [],
      resolveDependencies: async () => ({ dependencies: [], canProceed: true, requiredActions: [], installOrder: [] }),
      checkNamespaces: async (input): Promise<CheckNamespaceResult> => ({
        available: false,
        conflicts: [{
          type: 'namespace_conflict' as const,
          requestedNamespace: 'acme',
          conflictingPackageId: 'com.other.plugin',
          conflictingPackageName: 'Other Plugin',
          suggestion: 'acme_crm',
        }],
      }),
      planUpgrade: async () => ({ packageId: '', fromVersion: '', toVersion: '', impactLevel: 'none', changes: [] }),
      upgrade: async () => ({ success: true, phase: 'completed' }),
      rollback: async () => ({ success: true }),
    };

    const result = await service.checkNamespaces({
      namespaces: ['acme'],
      packageId: 'com.acme.crm',
    });

    expect(result.available).toBe(false);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].requestedNamespace).toBe('acme');
    expect(result.conflicts[0].suggestion).toBe('acme_crm');
  });

  it('should generate an upgrade plan with impact analysis', async () => {
    const service: IPackageService = {
      install: async () => ({ package: {} as InstalledPackage }),
      uninstall: async () => ({ success: true }),
      getPackage: async () => null,
      listPackages: async () => [],
      resolveDependencies: async () => ({ dependencies: [], canProceed: true, requiredActions: [], installOrder: [] }),
      checkNamespaces: async () => ({ available: true, conflicts: [] }),
      planUpgrade: async (): Promise<UpgradePlan> => ({
        packageId: 'com.acme.crm',
        fromVersion: '1.0.0',
        toVersion: '2.0.0',
        impactLevel: 'high',
        changes: [
          { type: 'object', name: 'account', changeType: 'modified', summary: 'Added 3 new fields' },
          { type: 'view', name: 'account_list', changeType: 'modified', summary: 'Updated column layout' },
          { type: 'flow', name: 'onboarding_flow', changeType: 'added', summary: 'New onboarding automation' },
        ],
        requiresMigration: true,
        migrationScripts: ['migrations/v2_add_account_fields.ts'],
        dependencyUpgrades: [{ packageId: 'com.acme.core', fromVersion: '1.2.0', toVersion: '2.0.0' }],
        estimatedDurationSeconds: 120,
        summary: 'Major upgrade with 3 metadata changes and 1 migration',
      }),
      upgrade: async () => ({ success: true, phase: 'completed' }),
      rollback: async () => ({ success: true }),
    };

    const plan = await service.planUpgrade({
      packageId: 'com.acme.crm',
      targetVersion: '2.0.0',
    });

    expect(plan.impactLevel).toBe('high');
    expect(plan.changes).toHaveLength(3);
    expect(plan.requiresMigration).toBe(true);
    expect(plan.migrationScripts).toHaveLength(1);
    expect(plan.dependencyUpgrades).toHaveLength(1);
    expect(plan.estimatedDurationSeconds).toBe(120);
  });

  it('should execute upgrade and support rollback', async () => {
    const service: IPackageService = {
      install: async () => ({ package: {} as InstalledPackage }),
      uninstall: async () => ({ success: true }),
      getPackage: async () => null,
      listPackages: async () => [],
      resolveDependencies: async () => ({ dependencies: [], canProceed: true, requiredActions: [], installOrder: [] }),
      checkNamespaces: async () => ({ available: true, conflicts: [] }),
      planUpgrade: async () => ({ packageId: '', fromVersion: '', toVersion: '', impactLevel: 'none', changes: [] }),
      upgrade: async (): Promise<UpgradePackageResponse> => ({
        success: true,
        phase: 'completed',
        snapshotId: 'snap_001',
        message: 'Upgrade completed successfully',
      }),
      rollback: async (): Promise<RollbackPackageResponse> => ({
        success: true,
        restoredVersion: '1.0.0',
        message: 'Rolled back to version 1.0.0',
      }),
    };

    const upgradeResult = await service.upgrade({
      packageId: 'com.acme.crm',
      targetVersion: '2.0.0',
      createSnapshot: true,
      mergeStrategy: 'three-way-merge',
    });
    expect(upgradeResult.success).toBe(true);
    expect(upgradeResult.phase).toBe('completed');
    expect(upgradeResult.snapshotId).toBe('snap_001');

    const rollbackResult = await service.rollback({
      packageId: 'com.acme.crm',
      snapshotId: 'snap_001',
      rollbackCustomizations: true,
    });
    expect(rollbackResult.success).toBe(true);
    expect(rollbackResult.restoredVersion).toBe('1.0.0');
  });

  it('should resolve dependencies with platform compatibility', async () => {
    const service: IPackageService = {
      install: async () => ({ package: {} as InstalledPackage }),
      uninstall: async () => ({ success: true }),
      getPackage: async () => null,
      listPackages: async () => [],
      resolveDependencies: async (): Promise<DependencyResolutionResult> => ({
        dependencies: [
          { packageId: 'com.acme.core', requiredRange: '^2.0.0', resolvedVersion: '2.1.0', status: 'satisfied' },
          { packageId: 'com.acme.ui', requiredRange: '^1.5.0', status: 'needs_install', resolvedVersion: '1.5.2' },
        ],
        canProceed: true,
        requiredActions: [
          { type: 'install', packageId: 'com.acme.ui', description: 'Install com.acme.ui@1.5.2' },
        ],
        installOrder: ['com.acme.core', 'com.acme.ui', 'com.acme.crm'],
      }),
      checkNamespaces: async () => ({ available: true, conflicts: [] }),
      planUpgrade: async () => ({ packageId: '', fromVersion: '', toVersion: '', impactLevel: 'none', changes: [] }),
      upgrade: async () => ({ success: true, phase: 'completed' }),
      rollback: async () => ({ success: true }),
    };

    const result = await service.resolveDependencies({
      manifest: { id: 'com.acme.crm', name: 'acme_crm', version: '1.0.0' } as any,
      platformVersion: '3.2.0',
    });

    expect(result.canProceed).toBe(true);
    expect(result.dependencies).toHaveLength(2);
    expect(result.requiredActions).toHaveLength(1);
    expect(result.installOrder).toEqual(['com.acme.core', 'com.acme.ui', 'com.acme.crm']);
  });
});
