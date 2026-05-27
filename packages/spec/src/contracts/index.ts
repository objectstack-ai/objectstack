// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectStack Contracts
 * 
 * Core interface definitions following "Protocol First" principle.
 * All interfaces should be defined in @objectstack/spec to avoid circular dependencies.
 */

export * from './logger.js';
export * from './data-engine.js';
export * from './data-driver.js';
export * from './http-server.js';
export * from './service-registry.js';
export * from './plugin-validator.js';
export * from './startup-orchestrator.js';
export * from './plugin-lifecycle-events.js';
export * from './schema-driver.js';
export * from './cache-service.js';
export * from './search-service.js';
export * from './queue-service.js';
export * from './notification-service.js';
export * from './storage-service.js';
export * from './metadata-service.js';
export * from './auth-service.js';
export * from './automation-service.js';
export * from './graphql-service.js';
export * from './analytics-service.js';
export * from './realtime-service.js';
export * from './job-service.js';
export * from './ai-service.js';
export * from './llm-adapter.js';
export * from './i18n-service.js';
export * from './ui-service.js';
export * from './workflow-service.js';
export * from './feed-service.js';
export * from './export-service.js';
export * from './email-service.js';
export * from './sharing-service.js';
export * from './share-link-service.js';
export * from './report-service.js';
export * from './approval-service.js';
export * from './package-service.js';
export * from './knowledge-service.js';
export * from './knowledge-adapter.js';
export * from './embedder.js';

// Provisioning & Deployment
export * from './turso-platform.js';
export * from './provisioning-service.js';
export * from './schema-diff-service.js';
export * from './deploy-pipeline-service.js';
export * from './tenant-router.js';
export * from './app-lifecycle-service.js';
export * from './seed-loader-service.js';
export * from './crypto-provider.js';
export * from './cluster-service.js';
