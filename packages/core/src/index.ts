// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/core
 * 
 * Core runtime for ObjectStack microkernel architecture.
 * Provides plugin system, dependency injection, and lifecycle management.
 */

export * from './kernel-base.js';
export * from './kernel.js';
export * from './lite-kernel.js';
export * from './types.js';
export * from './logger.js';
export * from './plugin-loader.js';
export * from './api-registry.js';
export * from './api-registry-plugin.js';
export * as QA from './qa/index.js';

// Export security utilities
export * from './security/index.js';

// Export environment utilities
export * from './utils/env.js';

// Export timezone-aware calendar utilities (ADR-0053 Phase 2)
export * from './utils/datetime.js';

// Export in-memory fallbacks for core-criticality services
export * from './fallbacks/index.js';

// Export Phase 2 components - Advanced lifecycle management
export * from './health-monitor.js';
export * from './hot-reload.js';
export * from './dependency-resolver.js';

// Export Phase 3 components - Package lifecycle management
export * from './namespace-resolver.js';

// Re-export contracts from @objectstack/spec for backward compatibility
export type { 
    Logger,
    IHttpServer,
    IHttpRequest,
    IHttpResponse,
    RouteHandler,
    Middleware,
    IDataEngine,
    IDataDriver,
    /** @deprecated Use `IDataDriver` instead */
    DriverInterface
} from '@objectstack/spec/contracts';
