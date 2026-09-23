import { describe, it, expect } from 'vitest';
import {
  PackageStatusEnum,
  InstalledPackageSchema,
  ListPackagesRequestSchema,
  ListPackagesResponseSchema,
  GetPackageRequestSchema,
  GetPackageResponseSchema,
  InstallPackageRequestSchema,
  InstallPackageResponseSchema,
  UninstallPackageRequestSchema,
  UninstallPackageResponseSchema,
  EnablePackageRequestSchema,
  EnablePackageResponseSchema,
  DisablePackageRequestSchema,
  DisablePackageResponseSchema,
  NamespaceRegistryEntrySchema,
  NamespaceConflictErrorSchema,
} from './package-registry.zod';

const validManifest = {
  id: 'com.acme.crm',
  version: '1.0.0',
  type: 'app' as const,
  name: 'Acme CRM',
};

describe('PackageStatusEnum', () => {
  it('should accept valid statuses', () => {
    const statuses = ['installed', 'disabled', 'installing', 'uninstalling', 'error'];
    statuses.forEach(status => {
      expect(() => PackageStatusEnum.parse(status)).not.toThrow();
    });
  });

  it('should reject invalid statuses', () => {
    expect(() => PackageStatusEnum.parse('active')).toThrow();
    expect(() => PackageStatusEnum.parse('')).toThrow();
  });
});

describe('InstalledPackageSchema', () => {
  it('should accept minimal installed package', () => {
    const pkg = { manifest: validManifest };
    expect(() => InstalledPackageSchema.parse(pkg)).not.toThrow();
  });

  it('should apply default values', () => {
    const parsed = InstalledPackageSchema.parse({ manifest: validManifest });
    expect(parsed.status).toBe('installed');
    expect(parsed.enabled).toBe(true);
  });

  it('should accept full installed package', () => {
    const pkg = {
      manifest: validManifest,
      status: 'disabled' as const,
      enabled: false,
      installedAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-02-01T12:00:00Z',
      statusChangedAt: '2025-02-01T12:00:00Z',
      errorMessage: 'Some error occurred',
      settings: { apiKey: 'secret', maxRetries: 3 },
    };

    const parsed = InstalledPackageSchema.parse(pkg);
    expect(parsed.status).toBe('disabled');
    expect(parsed.enabled).toBe(false);
    expect(parsed.settings?.apiKey).toBe('secret');
  });

  it('should accept installed package with upgrade history', () => {
    const pkg = {
      manifest: validManifest,
      upgradeHistory: [
        {
          fromVersion: '1.0.0',
          toVersion: '2.0.0',
          upgradedAt: '2025-03-01T12:00:00Z',
          status: 'success' as const,
          migrationLog: ['Migrated data schema', 'Updated indexes'],
        },
        {
          fromVersion: '2.0.0',
          toVersion: '2.1.0',
          upgradedAt: '2025-04-01T12:00:00Z',
          status: 'success' as const,
        },
      ],
    };
    const parsed = InstalledPackageSchema.parse(pkg);
    expect(parsed.upgradeHistory).toHaveLength(2);
    expect(parsed.upgradeHistory![0].status).toBe('success');
    expect(parsed.upgradeHistory![0].migrationLog).toHaveLength(2);
  });

  it('should accept upgrade history with failed/rolled_back status', () => {
    const pkg = {
      manifest: validManifest,
      upgradeHistory: [
        {
          fromVersion: '1.0.0',
          toVersion: '2.0.0',
          upgradedAt: '2025-03-01T12:00:00Z',
          status: 'failed' as const,
          migrationLog: ['Migration step failed: schema conflict'],
        },
        {
          fromVersion: '1.0.0',
          toVersion: '2.0.0',
          upgradedAt: '2025-03-02T12:00:00Z',
          status: 'rolled_back' as const,
        },
      ],
    };
    const parsed = InstalledPackageSchema.parse(pkg);
    expect(parsed.upgradeHistory![0].status).toBe('failed');
    expect(parsed.upgradeHistory![1].status).toBe('rolled_back');
  });

  it('should reject invalid datetime for installedAt', () => {
    expect(() => InstalledPackageSchema.parse({
      manifest: validManifest,
      installedAt: 'not-a-date',
    })).toThrow();
  });

  it('should reject invalid manifest', () => {
    expect(() => InstalledPackageSchema.parse({
      manifest: { id: 'com.example.test' },
    })).toThrow();
  });
});

describe('ListPackagesRequestSchema', () => {
  it('should accept empty request', () => {
    expect(() => ListPackagesRequestSchema.parse({})).not.toThrow();
  });

  it('should accept request with filters', () => {
    const parsed = ListPackagesRequestSchema.parse({
      status: 'installed',
      type: 'app',
      enabled: true,
    });
    expect(parsed.status).toBe('installed');
    expect(parsed.type).toBe('app');
    expect(parsed.enabled).toBe(true);
  });
});

describe('ListPackagesResponseSchema', () => {
  it('should accept valid response', () => {
    const response = {
      packages: [{ manifest: validManifest }],
      total: 1,
    };
    const parsed = ListPackagesResponseSchema.parse(response);
    expect(parsed.packages).toHaveLength(1);
    expect(parsed.total).toBe(1);
  });

  it('should accept empty packages list', () => {
    const parsed = ListPackagesResponseSchema.parse({ packages: [], total: 0 });
    expect(parsed.packages).toHaveLength(0);
  });
});

describe('GetPackageRequestSchema', () => {
  it('should accept valid request', () => {
    const parsed = GetPackageRequestSchema.parse({ id: 'com.acme.crm' });
    expect(parsed.id).toBe('com.acme.crm');
  });

  it('should reject missing id', () => {
    expect(() => GetPackageRequestSchema.parse({})).toThrow();
  });
});

describe('GetPackageResponseSchema', () => {
  it('should accept valid response', () => {
    const response = { package: { manifest: validManifest } };
    expect(() => GetPackageResponseSchema.parse(response)).not.toThrow();
  });
});

describe('InstallPackageRequestSchema', () => {
  it('should accept minimal install request', () => {
    const request = { manifest: validManifest };
    expect(() => InstallPackageRequestSchema.parse(request)).not.toThrow();
  });

  it('should leave an absent enableOnInstall UNDEFINED — it declares no default', () => {
    // ⭐ [#19273] Was `should apply default enableOnInstall` ⇒ `true`. This
    // declaration restates the install door's key, which was ruled onto
    // 「缺省 = 保持，有旗 = 设置」: absence is a state the door acts on, so no
    // default may resolve it away. The matrix that holds this copy equal to
    // its authority is `src/api/package-install-one-authority.test.ts`.
    const parsed = InstallPackageRequestSchema.parse({ manifest: validManifest });
    expect(parsed.enableOnInstall).toBeUndefined();
  });

  it('should still carry a spelled enableOnInstall through — both arms', () => {
    // The control in the other direction: absence became visible without the
    // key ceasing to mean anything.
    expect(InstallPackageRequestSchema.parse({ manifest: validManifest, enableOnInstall: true }).enableOnInstall).toBe(true);
    expect(InstallPackageRequestSchema.parse({ manifest: validManifest, enableOnInstall: false }).enableOnInstall).toBe(false);
  });

  it('should accept install request with settings', () => {
    const request = {
      manifest: validManifest,
      settings: { apiKey: 'abc123' },
      enableOnInstall: false,
    };
    const parsed = InstallPackageRequestSchema.parse(request);
    expect(parsed.enableOnInstall).toBe(false);
    expect(parsed.settings?.apiKey).toBe('abc123');
  });

  it('should accept install request with platformVersion', () => {
    const request = {
      manifest: validManifest,
      platformVersion: '3.2.1',
    };
    const parsed = InstallPackageRequestSchema.parse(request);
    expect(parsed.platformVersion).toBe('3.2.1');
  });
});

describe('InstallPackageResponseSchema', () => {
  it('should accept valid response', () => {
    const response = {
      package: { manifest: validManifest },
      message: 'Installed successfully',
    };
    expect(() => InstallPackageResponseSchema.parse(response)).not.toThrow();
  });
});

describe('UninstallPackageRequestSchema', () => {
  it('should accept valid request', () => {
    const parsed = UninstallPackageRequestSchema.parse({ id: 'com.acme.crm' });
    expect(parsed.id).toBe('com.acme.crm');
  });

  it('should reject missing id', () => {
    expect(() => UninstallPackageRequestSchema.parse({})).toThrow();
  });
});

describe('UninstallPackageResponseSchema', () => {
  it('should accept valid response', () => {
    const response = {
      id: 'com.acme.crm',
      success: true,
      message: 'Uninstalled',
    };
    const parsed = UninstallPackageResponseSchema.parse(response);
    expect(parsed.success).toBe(true);
  });

  it('should accept response without message', () => {
    const response = { id: 'com.acme.crm', success: false };
    expect(() => UninstallPackageResponseSchema.parse(response)).not.toThrow();
  });
});

describe('EnablePackageRequestSchema', () => {
  it('should accept valid request', () => {
    const parsed = EnablePackageRequestSchema.parse({ id: 'com.acme.crm' });
    expect(parsed.id).toBe('com.acme.crm');
  });
});

describe('EnablePackageResponseSchema', () => {
  it('should accept valid response', () => {
    const response = {
      package: { manifest: validManifest },
      message: 'Enabled',
    };
    expect(() => EnablePackageResponseSchema.parse(response)).not.toThrow();
  });
});

describe('DisablePackageRequestSchema', () => {
  it('should accept valid request', () => {
    const parsed = DisablePackageRequestSchema.parse({ id: 'com.acme.crm' });
    expect(parsed.id).toBe('com.acme.crm');
  });
});

describe('DisablePackageResponseSchema', () => {
  it('should accept valid response', () => {
    const response = {
      package: { manifest: validManifest },
      message: 'Disabled',
    };
    expect(() => DisablePackageResponseSchema.parse(response)).not.toThrow();
  });
});

describe('NamespaceRegistryEntrySchema', () => {
  it('should accept valid namespace entry', () => {
    const entry = {
      namespace: 'crm',
      packageId: 'com.acme.crm',
      registeredAt: '2025-06-01T12:00:00Z',
      status: 'active' as const,
    };
    const parsed = NamespaceRegistryEntrySchema.parse(entry);
    expect(parsed.namespace).toBe('crm');
    expect(parsed.status).toBe('active');
  });

  it('should accept all namespace statuses', () => {
    const statuses = ['active', 'disabled', 'reserved'] as const;
    statuses.forEach(status => {
      const entry = {
        namespace: 'test',
        packageId: 'com.test.pkg',
        registeredAt: '2025-06-01T12:00:00Z',
        status,
      };
      expect(() => NamespaceRegistryEntrySchema.parse(entry)).not.toThrow();
    });
  });

  it('should reject missing required fields', () => {
    expect(() => NamespaceRegistryEntrySchema.parse({})).toThrow();
  });
});

describe('NamespaceConflictErrorSchema', () => {
  it('should accept valid conflict error', () => {
    const error = {
      type: 'namespace_conflict' as const,
      requestedNamespace: 'crm',
      conflictingPackageId: 'com.acme.crm',
      conflictingPackageName: 'Acme CRM',
      suggestion: 'crm2',
    };
    const parsed = NamespaceConflictErrorSchema.parse(error);
    expect(parsed.type).toBe('namespace_conflict');
    expect(parsed.suggestion).toBe('crm2');
  });

  it('should accept conflict error without suggestion', () => {
    const error = {
      type: 'namespace_conflict' as const,
      requestedNamespace: 'hr',
      conflictingPackageId: 'com.acme.hr',
      conflictingPackageName: 'Acme HR',
    };
    const parsed = NamespaceConflictErrorSchema.parse(error);
    expect(parsed.suggestion).toBeUndefined();
  });

  it('should reject wrong type literal', () => {
    expect(() => NamespaceConflictErrorSchema.parse({
      type: 'other_error',
      requestedNamespace: 'crm',
      conflictingPackageId: 'com.acme.crm',
      conflictingPackageName: 'Acme CRM',
    })).toThrow();
  });
});

describe('InstalledPackageSchema - registeredNamespaces', () => {
  it('should accept package with registered namespaces', () => {
    const pkg = {
      manifest: validManifest,
      registeredNamespaces: ['crm', 'crm_ext'],
    };
    const parsed = InstalledPackageSchema.parse(pkg);
    expect(parsed.registeredNamespaces).toHaveLength(2);
  });

  it('should accept package without registered namespaces (backward compatible)', () => {
    const pkg = { manifest: validManifest };
    const parsed = InstalledPackageSchema.parse(pkg);
    expect(parsed.registeredNamespaces).toBeUndefined();
  });
});

describe('InstallPackageResponseSchema - dependencyResolution', () => {
  it('should accept response with dependency resolution', () => {
    const response = {
      package: { manifest: validManifest },
      message: 'Installed successfully',
      dependencyResolution: {
        dependencies: [
          {
            packageId: 'com.acme.auth',
            requiredRange: '^2.0.0',
            resolvedVersion: '2.1.0',
            status: 'satisfied' as const,
          },
        ],
        canProceed: true,
        requiredActions: [],
        installOrder: ['com.acme.auth', 'com.acme.crm'],
      },
    };
    const parsed = InstallPackageResponseSchema.parse(response);
    expect(parsed.dependencyResolution?.canProceed).toBe(true);
  });

  it('should accept response without dependency resolution (backward compatible)', () => {
    const response = {
      package: { manifest: validManifest },
    };
    const parsed = InstallPackageResponseSchema.parse(response);
    expect(parsed.dependencyResolution).toBeUndefined();
  });
});
