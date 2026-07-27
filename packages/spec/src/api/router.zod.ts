// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CorsConfigSchema, StaticMountSchema, HttpMethod } from '../shared/http.zod';

// Re-export HttpMethod for convenience
import { lazySchema } from '../shared/lazy-schema';
export { HttpMethod };

/**
 * Route Category Enum
 * Classifies routes for middleware application and security policies.
 */
export const RouteCategory = z.enum([
  'system',   // Health, Metrics, Info (No Auth usually)
  'api',      // Business Logic API (Auth required)
  'auth',     // Login/Callback endpoints
  'static',   // Asset serving
  'webhook',  // External callbacks
  'plugin'    // Plugin extensions
]);

export type RouteCategory = z.infer<typeof RouteCategory>;

/**
 * Route Definition Schema
 * Describes a single routable endpoint in the Kernel.
 */
export const RouteDefinitionSchema = lazySchema(() => z.object({
  /**
   * HTTP Method
   */
  method: HttpMethod,
  
  /**
   * URL Path Pattern (supports parameters like /user/:id)
   */
  path: z.string().describe('URL Path pattern'),
  
  /**
   * Route Type/Category
   */
  category: RouteCategory.default('api'),
  
  /**
   * Handler Identifier
   * References an internal function or plugin action ID.
   */
  handler: z.string().describe('Unique handler identifier'),
  
  /**
   * Route specific metadata
   */
  summary: z.string().optional().describe('OpenAPI summary'),
  description: z.string().optional().describe('OpenAPI description'),
  
  /**
   * Security constraints
   */
  public: z.boolean().default(false).describe('Is publicly accessible'),
  permissions: z.array(z.string()).optional().describe('Required permissions'),
  
  /**
   * Performance hints
   */
  timeout: z.number().int().optional().describe('Execution timeout in ms'),
  rateLimit: z.string().optional().describe('Rate limit policy name'),
}));

export type RouteDefinition = z.infer<typeof RouteDefinitionSchema>;

/**
 * Router Configuration Schema
 * Global routing table configuration.
 */
export const RouterConfigSchema = lazySchema(() => z.object({
  /**
   * URL Prefix for all kernel routes
   */
  basePath: z.string().default('/api').describe('Global API prefix'),
  
  /**
   * Standard Protocol Mounts (Relative to basePath)
   */
  mounts: z.object({
    data: z.string().default('/data').describe('Data Protocol (CRUD)'),
    metadata: z.string().default('/meta').describe('Metadata Protocol (Schemas)'),
    auth: z.string().default('/auth').describe('Auth Protocol'),
    automation: z.string().default('/automation').describe('Automation Protocol'),
    storage: z.string().default('/storage').describe('Storage Protocol'),
    analytics: z.string().default('/analytics').describe('Analytics Protocol'),
    ui: z.string().default('/ui').describe('UI Metadata Protocol (Views, Layouts)'),
    workflow: z.string().default('/workflow').describe('Workflow Engine Protocol'),
    realtime: z.string().default('/realtime').describe('Realtime/WebSocket Protocol'),
    notifications: z.string().default('/notifications').describe('Notification Protocol'),
    ai: z.string().default('/ai').describe('AI Engine Protocol (NLQ, Chat, Suggest)'),
    i18n: z.string().default('/i18n').describe('Internationalization Protocol'),
    packages: z.string().default('/packages').describe('Package Management Protocol'),
  }).default({
    data: '/data',
    metadata: '/meta',
    auth: '/auth',
    automation: '/automation',
    storage: '/storage',
    analytics: '/analytics',
    ui: '/ui',
    workflow: '/workflow',
    realtime: '/realtime',
    notifications: '/notifications',
    ai: '/ai',
    i18n: '/i18n',
    packages: '/packages',
  }), // Defaults match standardized spec

  /**
   * Cross-Origin Resource Sharing
   */
  cors: CorsConfigSchema.optional(),
  
  /**
   * Static asset mounts
   */
  staticMounts: z.array(StaticMountSchema).optional(),
}));

export type RouterConfig = z.infer<typeof RouterConfigSchema>;
