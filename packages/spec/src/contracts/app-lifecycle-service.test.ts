// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { IAppLifecycleService } from './app-lifecycle-service';
import type { AppManifest, AppCompatibilityCheck, AppInstallResult } from '../system/app-install.zod';

describe('App Lifecycle Service Contract', () => {
  const sampleManifest: AppManifest = {
    name: 'crm_basic',
    label: 'Basic CRM',
    version: '1.0.0',
    description: 'A basic CRM app',
    objects: ['contact', 'deal'],
    views: ['contact_list', 'deal_board'],
    flows: ['new_deal_notification'],
    hasSeedData: true,
    dependencies: [],
  };

  it('should allow a minimal IAppLifecycleService implementation with all required methods', () => {
    const service: IAppLifecycleService = {
      checkCompatibility: async () => ({ compatible: true, issues: [] }),
      installApp: async () => ({
        success: true,
        appId: 'crm_basic',
        version: '1.0.0',
        installedObjects: [],
        createdTables: [],
        seededRecords: 0,
      }),
      upgradeApp: async () => ({
        success: true,
        appId: 'crm_basic',
        version: '2.0.0',
        installedObjects: [],
        createdTables: [],
        seededRecords: 0,
      }),
      uninstallApp: async () => ({ success: true }),
    };

    expect(typeof service.checkCompatibility).toBe('function');
    expect(typeof service.installApp).toBe('function');
    expect(typeof service.upgradeApp).toBe('function');
    expect(typeof service.uninstallApp).toBe('function');
  });

  it('should check compatibility before installation', async () => {
    const service: IAppLifecycleService = {
      checkCompatibility: async (_tenantId, manifest) => {
        const issues: AppCompatibilityCheck['issues'] = [];
        if (manifest.minKernelVersion && manifest.minKernelVersion > '3.0.0') {
          issues.push({
            severity: 'error',
            message: 'Kernel version too low',
            category: 'kernel_version',
          });
        }
        return { compatible: issues.length === 0, issues };
      },
      installApp: async () => ({
        success: true,
        appId: 'crm_basic',
        version: '1.0.0',
        installedObjects: [],
        createdTables: [],
        seededRecords: 0,
      }),
      upgradeApp: async () => ({
        success: true,
        appId: 'crm_basic',
        version: '1.0.0',
        installedObjects: [],
        createdTables: [],
        seededRecords: 0,
      }),
      uninstallApp: async () => ({ success: true }),
    };

    const result = await service.checkCompatibility('tenant_001', sampleManifest);
    expect(result.compatible).toBe(true);
    expect(result.issues).toHaveLength(0);

    const incompatible = await service.checkCompatibility('tenant_001', {
      ...sampleManifest,
      minKernelVersion: '5.0.0',
    });
    expect(incompatible.compatible).toBe(false);
    expect(incompatible.issues).toHaveLength(1);
    expect(incompatible.issues[0].category).toBe('kernel_version');
  });

  it('should install an app into a tenant', async () => {
    const installedApps = new Map<string, AppInstallResult>();

    const service: IAppLifecycleService = {
      checkCompatibility: async () => ({ compatible: true, issues: [] }),
      installApp: async (_tenantId, manifest) => {
        const result: AppInstallResult = {
          success: true,
          appId: manifest.name,
          version: manifest.version,
          installedObjects: manifest.objects ?? [],
          createdTables: (manifest.objects ?? []).map(o => `app_${o}`),
          seededRecords: manifest.hasSeedData ? 50 : 0,
          durationMs: 2300,
        };
        installedApps.set(manifest.name, result);
        return result;
      },
      upgradeApp: async () => ({
        success: true,
        appId: 'crm_basic',
        version: '1.0.0',
        installedObjects: [],
        createdTables: [],
        seededRecords: 0,
      }),
      uninstallApp: async () => ({ success: true }),
    };

    const result = await service.installApp('tenant_001', sampleManifest);
    expect(result.success).toBe(true);
    expect(result.appId).toBe('crm_basic');
    expect(result.installedObjects).toEqual(['contact', 'deal']);
    expect(result.createdTables).toEqual(['app_contact', 'app_deal']);
    expect(result.seededRecords).toBe(50);
  });

  it('should upgrade an installed app', async () => {
    const service: IAppLifecycleService = {
      checkCompatibility: async () => ({ compatible: true, issues: [] }),
      installApp: async () => ({
        success: true,
        appId: 'crm_basic',
        version: '1.0.0',
        installedObjects: [],
        createdTables: [],
        seededRecords: 0,
      }),
      upgradeApp: async (_tenantId, manifest) => ({
        success: true,
        appId: manifest.name,
        version: manifest.version,
        installedObjects: manifest.objects ?? [],
        createdTables: [],
        seededRecords: 0,
        durationMs: 1100,
      }),
      uninstallApp: async () => ({ success: true }),
    };

    const upgradeManifest: AppManifest = {
      ...sampleManifest,
      version: '2.0.0',
      objects: ['contact', 'deal', 'activity'],
    };

    const result = await service.upgradeApp('tenant_001', upgradeManifest);
    expect(result.success).toBe(true);
    expect(result.version).toBe('2.0.0');
    expect(result.installedObjects).toContain('activity');
  });

  it('should uninstall an app', async () => {
    const apps = new Set(['crm_basic']);

    const service: IAppLifecycleService = {
      checkCompatibility: async () => ({ compatible: true, issues: [] }),
      installApp: async () => ({
        success: true,
        appId: 'crm_basic',
        version: '1.0.0',
        installedObjects: [],
        createdTables: [],
        seededRecords: 0,
      }),
      upgradeApp: async () => ({
        success: true,
        appId: 'crm_basic',
        version: '1.0.0',
        installedObjects: [],
        createdTables: [],
        seededRecords: 0,
      }),
      uninstallApp: async (_tenantId, appId) => {
        const existed = apps.delete(appId);
        return { success: existed };
      },
    };

    const result = await service.uninstallApp('tenant_001', 'crm_basic');
    expect(result.success).toBe(true);
    expect(apps.has('crm_basic')).toBe(false);

    const notFound = await service.uninstallApp('tenant_001', 'nonexistent');
    expect(notFound.success).toBe(false);
  });
});
