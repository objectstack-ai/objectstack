// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from './types.js';
import { ApiRegistry } from './api-registry.js';
import type { ConflictResolutionStrategy } from '@objectstack/spec/api';

/**
 * API Registry Plugin Configuration
 */
export interface ApiRegistryPluginConfig {
  /**
   * Conflict resolution strategy for route conflicts
   * @default 'error'
   */
  conflictResolution?: ConflictResolutionStrategy;
  
  /**
   * Registry version
   * @default '1.0.0'
   */
  version?: string;
}

/**
 * API Registry Plugin
 * 
 * Registers the API Registry service in the kernel, making it available
 * to all plugins for endpoint registration and discovery.
 * 
 * **Usage:**
 * ```typescript
 * const kernel = new ObjectKernel();
 * 
 * // Register API Registry Plugin
 * kernel.use(createApiRegistryPlugin({ conflictResolution: 'priority' }));
 * 
 * // In other plugins, access the API Registry
 * const plugin: Plugin = {
 *   name: 'my-plugin',
 *   init: async (ctx) => {
 *     const registry = ctx.getService<ApiRegistry>('api-registry');
 *     
 *     // Register plugin APIs
 *     registry.registerApi({
 *       id: 'my_plugin_api',
 *       name: 'My Plugin API',
 *       type: 'rest',
 *       version: 'v1',
 *       basePath: '/api/v1/my-plugin',
 *       endpoints: [...]
 *     });
 *   }
 * };
 * ```
 * 
 * @param config - Plugin configuration
 * @returns Plugin instance
 */
export function createApiRegistryPlugin(
  config: ApiRegistryPluginConfig = {}
): Plugin {
  const {
    conflictResolution = 'error',
    version = '1.0.0',
  } = config;

  return {
    name: 'com.objectstack.core.api-registry',
    /**
     * Services init() registers on every path (ADR-0116, #4131) — lets the
     * kernel name this plugin when a consumer requires one before it inits.
     */
    providesServices: ['api-registry'],
    type: 'standard',
    version: '1.0.0',

    init: async (ctx: PluginContext) => {
      // Create API Registry instance
      const registry = new ApiRegistry(
        ctx.logger,
        conflictResolution,
        version
      );

      // Register as a service
      ctx.registerService('api-registry', registry);

      ctx.logger.info('API Registry plugin initialized', {
        conflictResolution,
        version,
      });
    },
  };
}
