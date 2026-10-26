/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PluginSystem, type RegistryPluginDefinition } from '../PluginSystem';
import { Registry } from '../Registry';

describe('PluginSystem', () => {
  let pluginSystem: PluginSystem;
  let registry: Registry;

  beforeEach(() => {
    pluginSystem = new PluginSystem();
    registry = new Registry();
  });

  it('should load a simple plugin', async () => {
    const plugin: RegistryPluginDefinition = {
      name: 'test-plugin',
      version: '1.0.0',
      register: (reg) => {
        // `RegistryPluginDefinition.register` takes `Registry | PluginScope`,
        // and only the legacy `Registry` arm has `register()` — a scope
        // registers through `registerComponent()`. `loadPlugin(..., false)`
        // below selects the legacy arm, so narrow to it rather than assuming
        // it: if scoped loading ever became the default for this call, this
        // throws instead of failing somewhere further down (objectui#4040).
        if (!(reg instanceof Registry)) {
          throw new Error('expected the legacy Registry in useScope:false mode');
        }
        reg.register('test', () => 'test');
      }
    };

    // Use legacy mode (useScope: false) to test direct registry access
    await pluginSystem.loadPlugin(plugin, registry, false);
    
    expect(pluginSystem.isLoaded('test-plugin')).toBe(true);
    expect(pluginSystem.getLoadedPlugins()).toContain('test-plugin');
    expect(registry.has('test')).toBe(true);
  });

  it('should execute onLoad lifecycle hook', async () => {
    const onLoad = vi.fn();
    const plugin: RegistryPluginDefinition = {
      name: 'test-plugin',
      version: '1.0.0',
      register: () => {},
      onLoad
    };

    await pluginSystem.loadPlugin(plugin, registry);
    
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('should execute async onLoad lifecycle hook', async () => {
    const onLoad = vi.fn().mockResolvedValue(undefined);
    const plugin: RegistryPluginDefinition = {
      name: 'test-plugin',
      version: '1.0.0',
      register: () => {},
      onLoad
    };

    await pluginSystem.loadPlugin(plugin, registry);
    
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('should not load plugin twice', async () => {
    const onLoad = vi.fn();
    const plugin: RegistryPluginDefinition = {
      name: 'test-plugin',
      version: '1.0.0',
      register: () => {},
      onLoad
    };

    await pluginSystem.loadPlugin(plugin, registry);
    await pluginSystem.loadPlugin(plugin, registry);
    
    expect(onLoad).toHaveBeenCalledTimes(1);
  });

  it('should check dependencies before loading', async () => {
    const plugin: RegistryPluginDefinition = {
      name: 'dependent-plugin',
      version: '1.0.0',
      dependencies: ['base-plugin'],
      register: () => {}
    };

    await expect(pluginSystem.loadPlugin(plugin, registry)).rejects.toThrow(
      'Missing dependency: base-plugin required by dependent-plugin'
    );
  });

  it('should load plugins with dependencies in correct order', async () => {
    const basePlugin: RegistryPluginDefinition = {
      name: 'base-plugin',
      version: '1.0.0',
      register: () => {}
    };

    const dependentPlugin: RegistryPluginDefinition = {
      name: 'dependent-plugin',
      version: '1.0.0',
      dependencies: ['base-plugin'],
      register: () => {}
    };

    await pluginSystem.loadPlugin(basePlugin, registry);
    await pluginSystem.loadPlugin(dependentPlugin, registry);
    
    expect(pluginSystem.isLoaded('base-plugin')).toBe(true);
    expect(pluginSystem.isLoaded('dependent-plugin')).toBe(true);
  });

  it('should unload a plugin', async () => {
    const onUnload = vi.fn();
    const plugin: RegistryPluginDefinition = {
      name: 'test-plugin',
      version: '1.0.0',
      register: () => {},
      onUnload
    };

    await pluginSystem.loadPlugin(plugin, registry);
    expect(pluginSystem.isLoaded('test-plugin')).toBe(true);
    
    await pluginSystem.unloadPlugin('test-plugin');
    
    expect(pluginSystem.isLoaded('test-plugin')).toBe(false);
    expect(onUnload).toHaveBeenCalledTimes(1);
  });

  it('should prevent unloading plugin with dependents', async () => {
    const basePlugin: RegistryPluginDefinition = {
      name: 'base-plugin',
      version: '1.0.0',
      register: () => {}
    };

    const dependentPlugin: RegistryPluginDefinition = {
      name: 'dependent-plugin',
      version: '1.0.0',
      dependencies: ['base-plugin'],
      register: () => {}
    };

    await pluginSystem.loadPlugin(basePlugin, registry);
    await pluginSystem.loadPlugin(dependentPlugin, registry);
    
    await expect(pluginSystem.unloadPlugin('base-plugin')).rejects.toThrow(
      'Cannot unload plugin "base-plugin" - plugin "dependent-plugin" depends on it'
    );
  });

  it('should throw error when unloading non-existent plugin', async () => {
    await expect(pluginSystem.unloadPlugin('non-existent')).rejects.toThrow(
      'Plugin "non-existent" is not loaded'
    );
  });

  it('should get plugin definition', async () => {
    const plugin: RegistryPluginDefinition = {
      name: 'test-plugin',
      version: '1.0.0',
      register: () => {}
    };

    await pluginSystem.loadPlugin(plugin, registry);
    
    const retrieved = pluginSystem.getPlugin('test-plugin');
    expect(retrieved).toBe(plugin);
  });

  it('should get all plugins', async () => {
    const plugin1: RegistryPluginDefinition = {
      name: 'plugin-1',
      version: '1.0.0',
      register: () => {}
    };

    const plugin2: RegistryPluginDefinition = {
      name: 'plugin-2',
      version: '1.0.0',
      register: () => {}
    };

    await pluginSystem.loadPlugin(plugin1, registry);
    await pluginSystem.loadPlugin(plugin2, registry);
    
    const allPlugins = pluginSystem.getAllPlugins();
    expect(allPlugins).toHaveLength(2);
    expect(allPlugins).toContain(plugin1);
    expect(allPlugins).toContain(plugin2);
  });

  it('should call register function with registry', async () => {
    const registerFn = vi.fn();
    const plugin: RegistryPluginDefinition = {
      name: 'test-plugin',
      version: '1.0.0',
      register: registerFn
    };

    // Use legacy mode (useScope: false) to verify the raw Registry is passed
    await pluginSystem.loadPlugin(plugin, registry, false);
    
    expect(registerFn).toHaveBeenCalledWith(registry);
    expect(registerFn).toHaveBeenCalledTimes(1);
  });

  it('should cleanup on registration failure', async () => {
    const plugin: RegistryPluginDefinition = {
      name: 'failing-plugin',
      version: '1.0.0',
      register: () => {
        throw new Error('Registration failed');
      }
    };

    await expect(pluginSystem.loadPlugin(plugin, registry)).rejects.toThrow('Registration failed');
    
    expect(pluginSystem.isLoaded('failing-plugin')).toBe(false);
    expect(pluginSystem.getPlugin('failing-plugin')).toBeUndefined();
  });

  describe('install / uninstall (AppMetadataPlugin)', () => {
    it('should install an AppMetadataPlugin and call init + start', async () => {
      const initFn = vi.fn();
      const startFn = vi.fn();
      const stopFn = vi.fn();

      const appPlugin = {
        name: '@test/my-plugin',
        version: '1.0.0',
        type: 'app-metadata' as const,
        description: 'Test metadata plugin',
        init: initFn,
        start: startFn,
        stop: stopFn,
        getConfig: () => ({ objects: [] }),
      };

      await pluginSystem.install(appPlugin, registry, { logger: console });

      expect(initFn).toHaveBeenCalledTimes(1);
      expect(startFn).toHaveBeenCalledTimes(1);
      expect(startFn).toHaveBeenCalledWith({ logger: console });
      expect(pluginSystem.isLoaded('@test/my-plugin')).toBe(true);
    });

    it('should not install the same plugin twice', async () => {
      const appPlugin = {
        name: '@test/dup-plugin',
        version: '1.0.0',
        type: 'app-metadata' as const,
        init: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };

      await pluginSystem.install(appPlugin, registry);
      await pluginSystem.install(appPlugin, registry);

      expect(appPlugin.init).toHaveBeenCalledTimes(1);
    });

    it('should uninstall a plugin and call stop', async () => {
      const stopFn = vi.fn();
      const appPlugin = {
        name: '@test/removable',
        version: '1.0.0',
        type: 'app-metadata' as const,
        init: vi.fn(),
        start: vi.fn(),
        stop: stopFn,
      };

      await pluginSystem.install(appPlugin, registry);
      expect(pluginSystem.isLoaded('@test/removable')).toBe(true);

      await pluginSystem.uninstall('@test/removable');
      expect(pluginSystem.isLoaded('@test/removable')).toBe(false);
      expect(stopFn).toHaveBeenCalledTimes(1);
    });

    it('should throw when uninstalling a plugin that is not installed', async () => {
      await expect(pluginSystem.uninstall('@test/nonexistent')).rejects.toThrow(
        'Plugin "@test/nonexistent" is not loaded'
      );
    });

    it('should provide default context when none is given', async () => {
      const startFn = vi.fn();
      const appPlugin = {
        name: '@test/default-ctx',
        version: '1.0.0',
        type: 'app-metadata' as const,
        init: vi.fn(),
        start: startFn,
        stop: vi.fn(),
      };

      await pluginSystem.install(appPlugin, registry);

      expect(startFn).toHaveBeenCalledWith({ logger: console });
    });
  });
});
