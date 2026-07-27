// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Service Registry Protocol
 * 
 * Defines the standard built-in services that constitute the ObjectStack Kernel.
 * This registry is used by the `ObjectKernel` and `HttpDispatcher` to:
 * 1. Verify service availability.
 * 2. Route requests to the correct service handler.
 * 3. Type-check service interactions.
 */

// ==========================================
// Service Identifiers
// ==========================================

import { lazySchema } from '../shared/lazy-schema';
export const CoreServiceName = z.enum([
  // Core Data & Metadata
  'metadata',       // Object/Field Definitions
  'data',           // CRUD & Query Engine
  'auth',           // Authentication & Identity
  
  // Infrastructure
  'file-storage',   // Storage Driver (Local/S3)
  'search',         // Search Engine (Elastic/Meili)
  'cache',          // Cache Driver (Redis/Memory)
  'queue',          // Job Queue (BullMQ/Redis)
  
  // Advanced Capabilities
  'automation',     // Flow & Script Engine
  'analytics',      // BI & Semantic Layer
  'realtime',       // WebSocket & PubSub
  'job',            // Background Job Manager
  'notification',   // Email/Push/SMS
  'ai',             // AI Engine (NLQ, Chat, Suggest, Insights)
  'i18n',           // Internationalization Service
  'ui',             // UI Metadata Service (View CRUD)
  'workflow',       // Workflow State Machine Engine
]);

export type CoreServiceName = z.infer<typeof CoreServiceName>;

/**
 * Service Criticality Level
 * Defines the startup behavior when a service is missing.
 */
export const ServiceCriticalitySchema = lazySchema(() => z.enum([
  'required', // System fails to start if missing (Exit Code 1)
  'core',     // System warns if missing, functionality degraded (Warn)
  'optional', // System ignores if missing, feature disabled (Info)
]));

/**
 * Service Requirement Definition
 */
export const ServiceRequirementDef = {
  // Required: The kernel cannot function without these
  data: 'required',

  // Core: Highly recommended, defaults to in-memory / no-op if missing
  metadata: 'core',
  auth: 'core',

  // Core: Highly recommended, defaults to in-memory / no-op if missing
  cache: 'core',
  queue: 'core',
  job: 'core',
  i18n: 'core',

  // Optional: Add-on capabilities
  'file-storage': 'optional',
  search: 'optional',
  automation: 'optional',
  analytics: 'optional',
  realtime: 'optional',
  notification: 'optional',
  ai: 'optional',
  ui: 'optional',
  workflow: 'optional',
} as const;

// ==========================================
// Service Capabilities
// ==========================================

/**
 * Describes the availability and health of a service
 */
export const ServiceStatusSchema = lazySchema(() => z.object({
  name: CoreServiceName,
  enabled: z.boolean(),
  status: z.enum(['running', 'stopped', 'degraded', 'initializing']),
  version: z.string().optional(),
  provider: z.string().optional().describe('Implementation provider (e.g. "s3" for storage)'),
  features: z.array(z.string()).optional().describe('List of supported sub-features'),
}));

/**
 * The Contract definition for what the Kernel MUST expose
 * map<ServiceName, ServiceInstance>
 */
export const KernelServiceMapSchema = lazySchema(() => z.record(
  CoreServiceName, 
  z.unknown().describe('Service Instance implementing the protocol interface')
));

// ==========================================
// Service Interfaces (Stub definitions)
// ==========================================
// Ideally, we would define strict Typescript interfaces here 
// for what methods each service must expose to the Registry.
// For Zod, we primarily validate configuration and status.

// e.g.
export const ServiceConfigSchema = lazySchema(() => z.object({
  id: z.string(),
  name: CoreServiceName,
  options: z.record(z.string(), z.unknown()).optional(),
}));
