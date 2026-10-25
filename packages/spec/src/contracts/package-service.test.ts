import { describe, it, expect } from 'vitest';
import type {
  IPackageService,
  InstallPackageInput,
  InstallPackageResult,
  CheckNamespaceResult,
} from './package-service';
import type { InstalledPackage } from '../kernel/package-registry.zod';
import type { DependencyResolutionResult } from '../kernel/dependency-resolution.zod';

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
    };

    expect(typeof service.install).toBe('function');
    expect(typeof service.uninstall).toBe('function');
    expect(typeof service.resolveDependencies).toBe('function');
    expect(typeof service.checkNamespaces).toBe('function');
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
      uploadArtifact: async () => ({ success: true }),
      togglePackage: async () => ({} as InstalledPackage),
    };

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
