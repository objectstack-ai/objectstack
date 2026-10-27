import { describe, it, expect } from 'vitest';
import {
  AppManifestSchema,
  AppCompatibilityCheckSchema,
  AppInstallRequestSchema,
  AppInstallResultSchema,
  type AppManifest,
  type AppCompatibilityCheck,
  type AppInstallRequest,
  type AppInstallResult,
} from './app-install.zod';

describe('AppManifestSchema', () => {
  it('should accept full app manifest', () => {
    const manifest: AppManifest = {
      name: 'project_management',
      label: 'Project Management',
      version: '1.0.0',
      description: 'A project management app',
      minKernelVersion: '3.0.0',
      objects: ['project', 'project_task'],
      views: ['project_board', 'task_list'],
      flows: ['auto_assign', 'notify_on_complete'],
      hasSeedData: true,
    };
    const parsed = AppManifestSchema.parse(manifest);
    expect(parsed.name).toBe('project_management');
    expect(parsed.objects).toHaveLength(2);
    expect(parsed.hasSeedData).toBe(true);
  });

  it('should accept minimal manifest with defaults', () => {
    const manifest = {
      name: 'simple_app',
      label: 'Simple App',
      version: '0.1.0',
    };
    const parsed = AppManifestSchema.parse(manifest);
    expect(parsed.objects).toEqual([]);
    expect(parsed.views).toEqual([]);
    expect(parsed.flows).toEqual([]);
    expect(parsed.hasSeedData).toBe(false);
    expect(parsed.seedData).toEqual([]);
    // `dependencies` is a retired tombstone (ADR-0141 D8): it materializes nothing.
    expect(parsed).not.toHaveProperty('dependencies');
  });

  it('should enforce snake_case name', () => {
    expect(() => AppManifestSchema.parse({
      name: 'InvalidName',
      label: 'Test',
      version: '1.0.0',
    })).toThrow();
  });

  it('should accept valid snake_case names', () => {
    const names = ['my_app', 'app1', 'project_management_v2'];
    names.forEach((name) => {
      expect(() => AppManifestSchema.parse({ name, label: 'Test', version: '1.0.0' })).not.toThrow();
    });
  });

  it('should reject names starting with a number', () => {
    expect(() => AppManifestSchema.parse({
      name: '1_bad_name',
      label: 'Test',
      version: '1.0.0',
    })).toThrow();
  });
});

describe('AppCompatibilityCheckSchema', () => {
  it('should accept compatible result', () => {
    const result: AppCompatibilityCheck = {
      compatible: true,
      issues: [],
    };
    expect(() => AppCompatibilityCheckSchema.parse(result)).not.toThrow();
  });

  it('should accept incompatible result with issues', () => {
    const result: AppCompatibilityCheck = {
      compatible: false,
      issues: [
        { severity: 'error', message: 'Kernel version too old', category: 'kernel_version' },
        { severity: 'warning', message: 'Object "task" already exists', category: 'object_conflict' },
        { severity: 'error', message: 'Missing dependency: core_crm', category: 'dependency_missing' },
      ],
    };
    const parsed = AppCompatibilityCheckSchema.parse(result);
    expect(parsed.issues).toHaveLength(3);
  });

  it('should accept all issue categories', () => {
    const categories = ['kernel_version', 'object_conflict', 'dependency_missing', 'quota_exceeded'];
    categories.forEach((category) => {
      const result = {
        compatible: false,
        issues: [{ severity: 'error', message: 'test', category }],
      };
      expect(() => AppCompatibilityCheckSchema.parse(result)).not.toThrow();
    });
  });
});

describe('AppInstallRequestSchema', () => {
  it('should accept full install request', () => {
    const request: AppInstallRequest = {
      tenantId: 'tenant_123',
      appId: 'project_management',
      configOverrides: { theme: 'dark' },
      skipSeedData: true,
    };
    const parsed = AppInstallRequestSchema.parse(request);
    expect(parsed.tenantId).toBe('tenant_123');
    expect(parsed.skipSeedData).toBe(true);
  });

  it('should accept minimal request with defaults', () => {
    const request = { tenantId: 'tenant_456', appId: 'simple_app' };
    const parsed = AppInstallRequestSchema.parse(request);
    expect(parsed.skipSeedData).toBe(false);
    expect(parsed.configOverrides).toBeUndefined();
  });

  it('should reject missing tenantId', () => {
    expect(() => AppInstallRequestSchema.parse({ appId: 'test' })).toThrow();
  });

  it('should reject missing appId', () => {
    expect(() => AppInstallRequestSchema.parse({ tenantId: 'test' })).toThrow();
  });
});

describe('AppInstallResultSchema', () => {
  it('should accept successful install result', () => {
    const result: AppInstallResult = {
      success: true,
      appId: 'project_management',
      version: '1.0.0',
      installedObjects: ['project', 'project_task'],
      createdTables: ['project', 'project_task'],
      seededRecords: 50,
      durationMs: 3200,
    };
    const parsed = AppInstallResultSchema.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.installedObjects).toHaveLength(2);
    expect(parsed.seededRecords).toBe(50);
  });

  it('should accept failed install result', () => {
    const result = {
      success: false,
      appId: 'broken_app',
      version: '0.1.0',
      error: 'Schema validation failed',
    };
    const parsed = AppInstallResultSchema.parse(result);
    expect(parsed.success).toBe(false);
    expect(parsed.installedObjects).toEqual([]);
    expect(parsed.seededRecords).toBe(0);
  });

  it('should reject missing required fields', () => {
    expect(() => AppInstallResultSchema.parse({ success: true })).toThrow();
  });
});
