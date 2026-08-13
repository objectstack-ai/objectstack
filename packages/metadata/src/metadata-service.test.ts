// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataManager } from './metadata-manager';
import { MemoryLoader } from './loaders/memory-loader';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import type { MetadataOverlay } from '@objectstack/spec/kernel';

// Suppress logger output during tests
vi.mock('@objectstack/core', async (orig) => ({
  // [#7378] Spread the REAL module: MetadataManager now also imports the
  // shared register-contract guard from @objectstack/core, and a mock that
  // names only createLogger breaks on every export the class gains.
  ...((await orig()) as object),
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('MetadataManager — IMetadataService Contract', () => {
  let manager: MetadataManager;
  let memoryLoader: MemoryLoader;

  beforeEach(() => {
    memoryLoader = new MemoryLoader();
    manager = new MetadataManager({
      formats: ['json'],
      loaders: [memoryLoader],
    });
    manager.setTypeRegistry(DEFAULT_METADATA_TYPE_REGISTRY);
  });

  // ==========================================
  // Core CRUD Operations
  // ==========================================

  describe('register / get', () => {
    it('should register and retrieve a metadata item', async () => {
      await manager.register('object', 'account', { name: 'account', label: 'Account' });
      const result = await manager.get('object', 'account');
      expect(result).toEqual({ name: 'account', label: 'Account' });
    });

    it('should return undefined for non-existent item', async () => {
      const result = await manager.get('object', 'nonexistent');
      expect(result).toBeUndefined();
    });

    it('should overwrite existing item on re-register', async () => {
      await manager.register('object', 'account', { name: 'account', label: 'V1' });
      await manager.register('object', 'account', { name: 'account', label: 'V2' });
      const result = await manager.get('object', 'account');
      expect(result).toEqual({ name: 'account', label: 'V2' });
    });

    it('should fall back to loaders when not in registry', async () => {
      await memoryLoader.save('object', 'contact', { name: 'contact', label: 'Contact' });
      const result = await manager.get('object', 'contact');
      expect(result).toEqual({ name: 'contact', label: 'Contact' });
    });
  });

  describe('list (IMetadataService)', () => {
    it('should return all items from registry and loaders', async () => {
      await manager.register('object', 'account', { name: 'account' });
      await memoryLoader.save('object', 'contact', { name: 'contact' });
      const items = await manager.list('object');
      expect(items).toHaveLength(2);
    });

    it('should deduplicate items between registry and loaders', async () => {
      await manager.register('object', 'account', { name: 'account', label: 'Registry' });
      await memoryLoader.save('object', 'account', { name: 'account', label: 'Loader' });
      const items = await manager.list('object');
      expect(items).toHaveLength(1);
      // Registry takes precedence
      expect((items[0] as any).label).toBe('Registry');
    });

    it('should return empty array for unknown type', async () => {
      const items = await manager.list('unknown_type');
      expect(items).toEqual([]);
    });
  });

  describe('unregister', () => {
    it('should remove an item from the registry', async () => {
      await manager.register('object', 'account', { name: 'account' });
      await manager.unregister('object', 'account');
      const result = await manager.get('object', 'account');
      expect(result).toBeUndefined();
    });

    it('should not throw when unregistering non-existent item', async () => {
      await expect(manager.unregister('object', 'nonexistent')).resolves.not.toThrow();
    });
  });

  describe('exists', () => {
    it('should find items in registry', async () => {
      await manager.register('view', 'my_view', { name: 'my_view' });
      expect(await manager.exists('view', 'my_view')).toBe(true);
    });

    it('should find items in loaders', async () => {
      await memoryLoader.save('object', 'task', { name: 'task' });
      expect(await manager.exists('object', 'task')).toBe(true);
    });

    it('should return false for non-existent items', async () => {
      expect(await manager.exists('object', 'nope')).toBe(false);
    });
  });

  describe('listNames', () => {
    it('should return names from both registry and loaders', async () => {
      await manager.register('object', 'account', { name: 'account' });
      await memoryLoader.save('object', 'contact', {});
      const names = await manager.listNames('object');
      expect(names).toContain('account');
      expect(names).toContain('contact');
    });

    it('should deduplicate names', async () => {
      await manager.register('object', 'account', { name: 'account' });
      await memoryLoader.save('object', 'account', {});
      const names = await manager.listNames('object');
      expect(names.filter(n => n === 'account')).toHaveLength(1);
    });
  });

  describe('getObject / listObjects', () => {
    it('getObject returns the registered document', async () => {
      await manager.register('object', 'account', { name: 'account', label: 'Account' });
      const result = await manager.getObject('account');
      expect(result).toEqual({ name: 'account', label: 'Account' });
    });

    it('listObjects returns the registered documents', async () => {
      await manager.register('object', 'account', { name: 'account' });
      await manager.register('object', 'contact', { name: 'contact' });
      const items = await manager.listObjects();
      expect(items).toHaveLength(2);
    });
  });

  // ==========================================
  // UI Convenience Methods
  // ==========================================

  describe('UI convenience methods', () => {
    it('should get a view via getView()', async () => {
      const viewDef = { name: 'account_list', object: 'account', type: 'grid' };
      await manager.register('view', 'account_list', viewDef);
      
      const result = await manager.getView('account_list');
      expect(result).toEqual(viewDef);
    });

    it('should list views via listViews()', async () => {
      await manager.register('view', 'account_list', { name: 'account_list', object: 'account' });
      await manager.register('view', 'contact_list', { name: 'contact_list', object: 'contact' });
      
      const allViews = await manager.listViews();
      expect(allViews).toHaveLength(2);
    });

    it('should filter views by object via listViews(object)', async () => {
      await manager.register('view', 'account_list', { name: 'account_list', object: 'account' });
      await manager.register('view', 'contact_list', { name: 'contact_list', object: 'contact' });
      
      const accountViews = await manager.listViews('account');
      expect(accountViews).toHaveLength(1);
      expect((accountViews[0] as any).name).toBe('account_list');
    });

    it('should get a dashboard via getDashboard()', async () => {
      const dashDef = { name: 'sales', label: 'Sales Overview' };
      await manager.register('dashboard', 'sales', dashDef);
      
      const result = await manager.getDashboard('sales');
      expect(result).toEqual(dashDef);
    });

    it('should list dashboards via listDashboards()', async () => {
      await manager.register('dashboard', 'sales', { name: 'sales' });
      await manager.register('dashboard', 'ops', { name: 'ops' });
      
      const dashboards = await manager.listDashboards();
      expect(dashboards).toHaveLength(2);
    });
  });

  // ==========================================
  // Package Management
  // ==========================================

  describe('unregisterPackage', () => {
    it('should remove all items from a package', async () => {
      await manager.register('object', 'crm_account', { name: 'crm_account', packageId: 'com.acme.crm' });
      await manager.register('object', 'crm_contact', { name: 'crm_contact', packageId: 'com.acme.crm' });
      await manager.register('object', 'sys_user', { name: 'sys_user', packageId: 'com.objectstack.core' });

      await manager.unregisterPackage('com.acme.crm');

      expect(await manager.get('object', 'crm_account')).toBeUndefined();
      expect(await manager.get('object', 'crm_contact')).toBeUndefined();
      expect(await manager.get('object', 'sys_user')).toBeDefined();
    });
  });

  // ==========================================
  // Query / Search
  // ==========================================

  describe('query', () => {
    beforeEach(async () => {
      await manager.register('object', 'account', { name: 'account', label: 'Account' });
      await manager.register('object', 'contact', { name: 'contact', label: 'Contact' });
      await manager.register('view', 'account_list', { name: 'account_list', label: 'Account List' });
    });

    it('should return all items when no filters', async () => {
      const result = await manager.query({});
      expect(result.total).toBeGreaterThanOrEqual(3);
      expect(result.page).toBe(1);
    });

    it('should filter by type', async () => {
      const result = await manager.query({ types: ['object'] });
      expect(result.total).toBe(2);
      expect(result.items.every(i => i.type === 'object')).toBe(true);
    });

    it('should support search', async () => {
      const result = await manager.query({ search: 'account' });
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.items.every(i =>
        i.name.includes('account') || (i.label && i.label.toLowerCase().includes('account'))
      )).toBe(true);
    });

    it('should support pagination', async () => {
      const result = await manager.query({ types: ['object'], page: 1, pageSize: 1 });
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(1);
    });

    it('should support sorting', async () => {
      const asc = await manager.query({ types: ['object'], sortBy: 'name', sortOrder: 'asc' });
      expect(asc.items[0].name).toBe('account');

      const desc = await manager.query({ types: ['object'], sortBy: 'name', sortOrder: 'desc' });
      expect(desc.items[0].name).toBe('contact');
    });
  });

  // ==========================================
  // Bulk Operations
  // ==========================================

  describe('bulkRegister', () => {
    it('should register multiple items at once', async () => {
      const result = await manager.bulkRegister([
        { type: 'object', name: 'account', data: { name: 'account' } },
        { type: 'object', name: 'contact', data: { name: 'contact' } },
        { type: 'view', name: 'account_list', data: { name: 'account_list' } },
      ]);

      expect(result.total).toBe(3);
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);

      expect(await manager.get('object', 'account')).toBeDefined();
      expect(await manager.get('view', 'account_list')).toBeDefined();
    });
  });

  describe('bulkUnregister', () => {
    it('should unregister multiple items at once', async () => {
      await manager.register('object', 'account', { name: 'account' });
      await manager.register('object', 'contact', { name: 'contact' });

      const result = await manager.bulkUnregister([
        { type: 'object', name: 'account' },
        { type: 'object', name: 'contact' },
      ]);

      expect(result.total).toBe(2);
      expect(result.succeeded).toBe(2);
      expect(await manager.get('object', 'account')).toBeUndefined();
    });
  });

  // ==========================================
  // Overlay / Customization
  // ==========================================

  describe('overlay management', () => {
    const testOverlay: MetadataOverlay = {
      id: 'overlay-1',
      baseType: 'object',
      baseName: 'account',
      scope: 'platform',
      patch: { label: 'Custom Account' },
      active: true,
    };

    it('should save and retrieve an overlay', async () => {
      await manager.saveOverlay(testOverlay);
      const result = await manager.getOverlay('object', 'account', 'platform');
      expect(result).toEqual(testOverlay);
    });

    it('should return undefined for missing overlay', async () => {
      const result = await manager.getOverlay('object', 'nonexistent');
      expect(result).toBeUndefined();
    });

    it('should remove an overlay', async () => {
      await manager.saveOverlay(testOverlay);
      await manager.removeOverlay('object', 'account', 'platform');
      const result = await manager.getOverlay('object', 'account', 'platform');
      expect(result).toBeUndefined();
    });

    it('should get effective metadata with overlays applied', async () => {
      await manager.register('object', 'account', { name: 'account', label: 'Account', type: 'object' });
      await manager.saveOverlay(testOverlay);

      const effective = await manager.getEffective('object', 'account') as any;
      expect(effective.label).toBe('Custom Account');
      expect(effective.name).toBe('account');
      expect(effective.type).toBe('object');
    });

    it('should apply user overlay on top of platform overlay', async () => {
      await manager.register('object', 'account', { name: 'account', label: 'Account' });

      await manager.saveOverlay({
        id: 'platform-1',
        baseType: 'object',
        baseName: 'account',
        scope: 'platform',
        patch: { label: 'Platform Label', description: 'Platform Desc' },
        active: true,
      });

      await manager.saveOverlay({
        id: 'user-1',
        baseType: 'object',
        baseName: 'account',
        scope: 'user',
        patch: { label: 'User Label' },
        active: true,
      });

      const effective = await manager.getEffective('object', 'account') as any;
      expect(effective.label).toBe('User Label');
      expect(effective.description).toBe('Platform Desc');
    });

    it('should not apply inactive overlays', async () => {
      await manager.register('object', 'account', { name: 'account', label: 'Original' });
      await manager.saveOverlay({
        id: 'inactive-1',
        baseType: 'object',
        baseName: 'account',
        scope: 'platform',
        patch: { label: 'Should Not Apply' },
        active: false,
      });

      const effective = await manager.getEffective('object', 'account') as any;
      expect(effective.label).toBe('Original');
    });

    it('should apply user overlay scoped to specific userId via getEffective context', async () => {
      await manager.register('view', 'account_list', { 
        name: 'account_list', 
        columns: ['name', 'email', 'status'] 
      });

      // Platform overlay
      await manager.saveOverlay({
        id: 'platform-view-1',
        baseType: 'view',
        baseName: 'account_list',
        scope: 'platform',
        patch: { columns: ['name', 'email', 'status', 'created_at'] },
        active: true,
      });

      // User-specific overlay
      await manager.saveOverlay({
        id: 'user-view-1',
        baseType: 'view',
        baseName: 'account_list',
        scope: 'user',
        owner: 'user-456',
        patch: { columns: ['name', 'status'] },
        active: true,
      });

      // Without context — should apply platform but not user overlay (no owner match)
      const general = await manager.getEffective('view', 'account_list') as any;
      expect(general.columns).toEqual(['name', 'email', 'status', 'created_at']);

      // With userId context — should apply user overlay
      const forUser = await manager.getEffective('view', 'account_list', { 
        userId: 'user-456' 
      }) as any;
      expect(forUser.columns).toEqual(['name', 'status']);
    });
  });

  // ==========================================
  // Watch / Subscribe (IMetadataService)
  // ==========================================

  describe('watchService', () => {
    it('should return a handle with unsubscribe', () => {
      const callback = vi.fn();
      const handle = manager.watchService('object', callback);
      expect(handle).toBeDefined();
      expect(typeof handle.unsubscribe).toBe('function');
    });

    it('should invoke callback on notification', () => {
      const callback = vi.fn();
      manager.watchService('object', callback);

      // Trigger via internal method
      (manager as any).notifyWatchers('object', {
        type: 'changed',
        metadataType: 'object',
        name: 'account',
        path: '/fake',
        timestamp: new Date().toISOString(),
      });

      expect(callback).toHaveBeenCalledOnce();
      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'updated', metadataType: 'object', name: 'account' })
      );
    });

    it('should stop invoking after unsubscribe', () => {
      const callback = vi.fn();
      const handle = manager.watchService('object', callback);
      handle.unsubscribe();

      (manager as any).notifyWatchers('object', {
        type: 'added',
        metadataType: 'object',
        name: 'account',
        path: '/fake',
        timestamp: new Date().toISOString(),
      });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ==========================================
  // Import / Export
  // ==========================================

  describe('exportMetadata', () => {
    it('should export all registered metadata', async () => {
      await manager.register('object', 'account', { name: 'account' });
      await manager.register('view', 'account_list', { name: 'account_list' });

      const bundle = await manager.exportMetadata() as Record<string, unknown[]>;
      expect(bundle.object).toHaveLength(1);
      expect(bundle.view).toHaveLength(1);
    });

    it('should filter by types', async () => {
      await manager.register('object', 'account', { name: 'account' });
      await manager.register('view', 'account_list', { name: 'account_list' });

      const bundle = await manager.exportMetadata({ types: ['object'] }) as Record<string, unknown[]>;
      expect(bundle.object).toHaveLength(1);
      expect(bundle.view).toBeUndefined();
    });
  });

  describe('importMetadata', () => {
    it('should import metadata from bundle', async () => {
      const bundle = {
        object: [{ name: 'account', label: 'Account' }, { name: 'contact', label: 'Contact' }],
        view: [{ name: 'account_list', label: 'Account List' }],
      };

      const result = await manager.importMetadata(bundle);
      expect(result.total).toBe(3);
      expect(result.imported).toBe(3);
      expect(result.failed).toBe(0);

      expect(await manager.get('object', 'account')).toBeDefined();
    });

    it('should skip existing items with skip strategy', async () => {
      await manager.register('object', 'account', { name: 'account', label: 'Original' });

      const bundle = {
        object: [{ name: 'account', label: 'Imported' }],
      };

      const result = await manager.importMetadata(bundle, { conflictResolution: 'skip' });
      expect(result.skipped).toBe(1);
      expect(result.imported).toBe(0);

      const item = await manager.get('object', 'account') as any;
      expect(item.label).toBe('Original');
    });

    it('should overwrite existing items with overwrite strategy', async () => {
      await manager.register('object', 'account', { name: 'account', label: 'Original' });

      const bundle = {
        object: [{ name: 'account', label: 'Overwritten' }],
      };

      const result = await manager.importMetadata(bundle, { conflictResolution: 'overwrite' });
      expect(result.imported).toBe(1);

      const item = await manager.get('object', 'account') as any;
      expect(item.label).toBe('Overwritten');
    });

    it('should merge existing items with merge strategy', async () => {
      await manager.register('object', 'account', { name: 'account', label: 'Original', type: 'object' });

      const bundle = {
        object: [{ name: 'account', label: 'Merged', description: 'New desc' }],
      };

      const result = await manager.importMetadata(bundle, { conflictResolution: 'merge' });
      expect(result.imported).toBe(1);

      const item = await manager.get('object', 'account') as any;
      expect(item.label).toBe('Merged');
      expect(item.type).toBe('object');
      expect(item.description).toBe('New desc');
    });

    it('should support dry run', async () => {
      const bundle = {
        object: [{ name: 'account', label: 'Account' }],
      };

      const result = await manager.importMetadata(bundle, { dryRun: true });
      expect(result.imported).toBe(1);

      // Should not actually register
      expect(await manager.get('object', 'account')).toBeUndefined();
    });
  });

  // ==========================================
  // Validation
  // ==========================================

  describe('validate', () => {
    it('should validate valid metadata', async () => {
      const result = await manager.validate('object', { name: 'account', label: 'Account' });
      expect(result.valid).toBe(true);
    });

    it('should reject null data', async () => {
      const result = await manager.validate('object', null);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('should reject non-object data', async () => {
      const result = await manager.validate('object', 'not-an-object');
      expect(result.valid).toBe(false);
    });

    it('should reject data without name field', async () => {
      const result = await manager.validate('object', { label: 'No Name' });
      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('name');
    });

    it('should warn about missing label', async () => {
      const result = await manager.validate('object', { name: 'account' });
      expect(result.valid).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some(w => w.path === 'label')).toBe(true);
    });
  });

  // ==========================================
  // Type Registry
  // ==========================================

  describe('type registry', () => {
    it('should return all registered types', async () => {
      const types = await manager.getRegisteredTypes();
      expect(types).toContain('object');
      expect(types).toContain('view');
      expect(types).toContain('flow');
      expect(types).toContain('agent');
    });

    it('should include custom types from registry', async () => {
      await manager.register('custom_type', 'item1', { name: 'item1' });
      const types = await manager.getRegisteredTypes();
      expect(types).toContain('custom_type');
    });

    it('should return type info for known types', async () => {
      const info = await manager.getTypeInfo('object');
      expect(info).toBeDefined();
      expect(info!.type).toBe('object');
      expect(info!.label).toBe('Object');
      expect(info!.domain).toBe('data');
      expect(info!.supportsOverlay).toBe(false);
      expect(info!.filePatterns).toBeDefined();
    });

    it('should return undefined for unknown types', async () => {
      const info = await manager.getTypeInfo('unknown_type');
      expect(info).toBeUndefined();
    });

    it('should emit no type-level actions for datasource by default', async () => {
      // The datasource "Test connection" action was relocated out of the
      // open-source registry into the datasource-admin backend plugin, which
      // registers it at install time. With that plugin absent (as in this
      // unit test), the type emits no actions.
      const info = await manager.getTypeInfo('datasource');
      expect(info).toBeDefined();
      expect('actions' in info!).toBe(false);
    });

    it('should surface a plugin-registered type-level action', async () => {
      const { registerMetadataTypeActions } = await import('@objectstack/spec/kernel');
      registerMetadataTypeActions('datasource', [
        {
          name: 'test_connection',
          label: 'Test connection',
          type: 'api',
          method: 'POST',
          target: '/api/v1/datasources/${ctx.recordId}/test',
          refreshAfter: false,
        } as any,
      ]);
      const info = await manager.getTypeInfo('datasource');
      const test = info!.actions?.find((a: any) => a.name === 'test_connection');
      expect(test).toMatchObject({ type: 'api', method: 'POST' });
    });

    it('should omit the actions key for types with no actions', async () => {
      const info = await manager.getTypeInfo('object');
      expect(info).toBeDefined();
      expect('actions' in info!).toBe(false);
    });
  });

  // ==========================================
  // Dependency Tracking
  // ==========================================

  describe('dependency tracking', () => {
    it('should track and retrieve dependencies', async () => {
      manager.addDependency({
        sourceType: 'view',
        sourceName: 'account_list',
        targetType: 'object',
        targetName: 'account',
        kind: 'reference',
      });

      const deps = await manager.getDependencies('view', 'account_list');
      expect(deps).toHaveLength(1);
      expect(deps[0].targetType).toBe('object');
      expect(deps[0].targetName).toBe('account');
    });

    it('should find dependents of a target', async () => {
      manager.addDependency({
        sourceType: 'view',
        sourceName: 'account_list',
        targetType: 'object',
        targetName: 'account',
        kind: 'reference',
      });

      manager.addDependency({
        sourceType: 'flow',
        sourceName: 'account_flow',
        targetType: 'object',
        targetName: 'account',
        kind: 'triggers',
      });

      const dependents = await manager.getDependents('object', 'account');
      expect(dependents).toHaveLength(2);
    });

    it('should return empty array when no dependencies', async () => {
      expect(await manager.getDependencies('object', 'nonexistent')).toEqual([]);
      expect(await manager.getDependents('object', 'nonexistent')).toEqual([]);
    });

    it('should not add duplicate dependencies', () => {
      const dep = {
        sourceType: 'view',
        sourceName: 'account_list',
        targetType: 'object',
        targetName: 'account',
        kind: 'reference' as const,
      };

      manager.addDependency(dep);
      manager.addDependency(dep);

      // Should only have one entry
      const deps = manager.getDependencies('view', 'account_list');
      return deps.then(result => expect(result).toHaveLength(1));
    });
  });

  // ==========================================
  // Package Publish / Revert / getPublished
  // ==========================================

  describe('publishPackage', () => {
    it('should publish all items in a package', async () => {
      await manager.register('object', 'opportunity', {
        name: 'opportunity', label: 'Opportunity', packageId: 'com.acme.crm', state: 'draft',
        metadata: { fields: ['name', 'amount'] },
      });
      await manager.register('view', 'opp_list', {
        name: 'opp_list', label: 'Opp List', packageId: 'com.acme.crm', state: 'draft',
        metadata: { columns: ['name', 'amount'] },
      });

      const result = await manager.publishPackage('com.acme.crm', { publishedBy: 'admin' });

      expect(result.success).toBe(true);
      expect(result.packageId).toBe('com.acme.crm');
      expect(result.version).toBe(1);
      expect(result.itemsPublished).toBe(2);
      expect(result.publishedAt).toBeDefined();

      // Verify items are now active with published snapshots
      const obj = await manager.get('object', 'opportunity') as any;
      expect(obj.state).toBe('active');
      expect(obj.publishedDefinition).toBeDefined();
      expect(obj.publishedBy).toBe('admin');
      expect(obj.publishedAt).toBeDefined();

      const view = await manager.get('view', 'opp_list') as any;
      expect(view.state).toBe('active');
      expect(view.publishedDefinition).toBeDefined();
    });

    it('should increment version on each publish', async () => {
      await manager.register('object', 'account', {
        name: 'account', packageId: 'crm', state: 'draft', version: 0,
        metadata: { fields: ['name'] },
      });

      const first = await manager.publishPackage('crm');
      expect(first.version).toBe(1);

      const second = await manager.publishPackage('crm');
      expect(second.version).toBe(2);
    });

    it('should fail for empty package', async () => {
      const result = await manager.publishPackage('nonexistent');
      expect(result.success).toBe(false);
      expect(result.itemsPublished).toBe(0);
      expect(result.validationErrors).toBeDefined();
    });

    it('should fail validation when items are invalid', async () => {
      // Register an item without a name (will fail validate)
      await manager.register('object', 'bad_item', {
        packageId: 'com.acme.bad', state: 'draft',
        metadata: {},
      });

      const result = await manager.publishPackage('com.acme.bad', { validate: true });
      expect(result.success).toBe(false);
      expect(result.validationErrors).toBeDefined();
      expect(result.validationErrors!.length).toBeGreaterThan(0);
    });

    it('should skip validation when validate=false', async () => {
      await manager.register('object', 'skip_val', {
        packageId: 'com.acme.skip', state: 'draft',
        metadata: {},
      });

      const result = await manager.publishPackage('com.acme.skip', { validate: false });
      expect(result.success).toBe(true);
      expect(result.itemsPublished).toBe(1);
    });

    it('should fail when dependency is not found or not published', async () => {
      await manager.register('view', 'opp_list', {
        name: 'opp_list', label: 'Opp List', packageId: 'com.acme.dep',
        metadata: { columns: ['name'] },
      });

      // Register a dependency pointing to a non-existent item
      manager.addDependency({
        sourceType: 'view',
        sourceName: 'opp_list',
        targetType: 'object',
        targetName: 'opportunity',
        kind: 'reference',
      });

      const result = await manager.publishPackage('com.acme.dep', { validate: true });
      expect(result.success).toBe(false);
      expect(result.validationErrors).toBeDefined();
      expect(result.validationErrors!.some(e => e.message.includes('opportunity'))).toBe(true);
    });

    it('should pass dependency check when target is in the same package', async () => {
      await manager.register('object', 'project', {
        name: 'project', label: 'Project', packageId: 'com.acme.same',
        metadata: { fields: ['name'] },
      });
      await manager.register('view', 'project_list', {
        name: 'project_list', label: 'Project List', packageId: 'com.acme.same',
        metadata: { columns: ['name'] },
      });

      // Dependency within the same package
      manager.addDependency({
        sourceType: 'view',
        sourceName: 'project_list',
        targetType: 'object',
        targetName: 'project',
        kind: 'reference',
      });

      const result = await manager.publishPackage('com.acme.same', { validate: true });
      expect(result.success).toBe(true);
      expect(result.itemsPublished).toBe(2);
    });

    it('should pass dependency check when target is already published', async () => {
      // Pre-existing published object (different package)
      await manager.register('object', 'account', {
        name: 'account', label: 'Account', packageId: 'com.acme.core',
        publishedDefinition: { fields: ['name'] },
        state: 'active',
      });

      // View in a different package references the published object
      await manager.register('view', 'account_list', {
        name: 'account_list', label: 'Account List', packageId: 'com.acme.views',
        metadata: { columns: ['name'] },
      });

      manager.addDependency({
        sourceType: 'view',
        sourceName: 'account_list',
        targetType: 'object',
        targetName: 'account',
        kind: 'reference',
      });

      const result = await manager.publishPackage('com.acme.views', { validate: true });
      expect(result.success).toBe(true);
      expect(result.itemsPublished).toBe(1);
    });
  });

  describe('revertPackage', () => {
    it('should revert to last published state', async () => {
      // Register and publish
      await manager.register('object', 'account', {
        name: 'account', label: 'Account', packageId: 'crm',
        metadata: { fields: ['name', 'email'] },
      });
      await manager.publishPackage('crm');

      // Make edits after publish
      const item = await manager.get('object', 'account') as any;
      await manager.register('object', 'account', {
        ...item,
        metadata: { fields: ['name', 'email', 'phone'] },
        state: 'draft',
      });

      // Verify edit was saved
      const edited = await manager.get('object', 'account') as any;
      expect(edited.metadata.fields).toContain('phone');

      // Revert
      await manager.revertPackage('crm');

      // Verify reverted to published state
      const reverted = await manager.get('object', 'account') as any;
      expect(reverted.state).toBe('active');
      expect(reverted.metadata).toEqual(reverted.publishedDefinition);
    });

    // [#7559] Both refusals assert `code` AND `status`, not just the message.
    // `rejects.toThrow('…')` was green against the naked `Error` these sites
    // used to throw — the throw was never the defect; the missing ADR-0112
    // envelope was, and it is what made `POST /packages/:id/revert` answer 500
    // for two perfectly ordinary refusals.
    it('should refuse a non-existent package with RESOURCE_NOT_FOUND / 404', async () => {
      await expect(manager.revertPackage('nonexistent')).rejects.toMatchObject({
        code: 'RESOURCE_NOT_FOUND',
        status: 404,
        message: expect.stringContaining('No metadata items found'),
      });
    });

    it('should refuse a never-published package with RESOURCE_CONFLICT / 409', async () => {
      await manager.register('object', 'new_item', {
        name: 'new_item', packageId: 'com.acme.new',
      });

      await expect(manager.revertPackage('com.acme.new')).rejects.toMatchObject({
        code: 'RESOURCE_CONFLICT',
        status: 409,
        message: expect.stringContaining('has never been published'),
      });
    });
  });

  describe('getPublished', () => {
    it('should return published definition when available', async () => {
      await manager.register('object', 'account', {
        name: 'account', label: 'Account', packageId: 'crm',
        metadata: { fields: ['name'] },
      });
      await manager.publishPackage('crm');

      // Edit after publish
      const item = await manager.get('object', 'account') as any;
      await manager.register('object', 'account', {
        ...item,
        metadata: { fields: ['name', 'email', 'phone'] },
      });

      // getPublished should return the published snapshot, not the edited version
      const published = await manager.getPublished('object', 'account');
      expect(published).toBeDefined();
      // The published snapshot was taken from the original metadata
      const pubAny = published as any;
      expect(pubAny.fields).toBeDefined();
    });

    it('should return current definition when never published', async () => {
      await manager.register('object', 'contact', {
        name: 'contact', label: 'Contact',
        metadata: { fields: ['first_name'] },
      });

      const published = await manager.getPublished('object', 'contact');
      expect(published).toBeDefined();
      // Falls back to metadata field
      expect((published as any).fields).toEqual(['first_name']);
    });

    it('should return undefined for non-existent item', async () => {
      const result = await manager.getPublished('object', 'nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('integration: edit → publish → edit → revert', () => {
    it('should preserve published version through edit-revert cycle', async () => {
      // Step 1: Initial setup
      await manager.register('object', 'project', {
        name: 'project', label: 'Project', packageId: 'pm',
        metadata: { fields: ['name', 'status'] },
      });

      // Step 2: Publish v1
      const v1 = await manager.publishPackage('pm', { publishedBy: 'admin' });
      expect(v1.success).toBe(true);
      expect(v1.version).toBe(1);

      // Step 3: Edit after publish
      const item = await manager.get('object', 'project') as any;
      await manager.register('object', 'project', {
        ...item,
        metadata: { fields: ['name', 'status', 'priority'] },
        state: 'draft',
      });

      // Step 4: End user sees published version
      const endUserView = await manager.getPublished('object', 'project') as any;
      expect(endUserView.fields).toEqual(['name', 'status']);

      // Step 5: Revert discards draft changes
      await manager.revertPackage('pm');
      const reverted = await manager.get('object', 'project') as any;
      expect(reverted.state).toBe('active');
      expect(reverted.metadata.fields).toEqual(['name', 'status']);
    });
  });
});
