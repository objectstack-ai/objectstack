// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectStack Contracts
 * 
 * Core interface definitions following "Protocol First" principle.
 * All interfaces should be defined in @objectstack/spec to avoid circular dependencies.
 */

export * from './logger.js';
export * from './data-engine.js';
export * from './objectql-engine.js';
// The hook-facing slice of the engine: what `HookContext.api` is (#5945).
export * from './scoped-context.js';
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
// The write→read round-trip cases every occupant of the `metadata` slot is
// checked against (#7223) — one table, a thin driver per implementation, the
// shape `data/filter-logic-conformance.ts` already uses for filter backends.
export * from './metadata-service-roundtrip-conformance.js';
export * from './auth-service.js';
export * from './automation-service.js';
export * from './analytics-service.js';
export * from './realtime-service.js';
export * from './job-service.js';
export * from './ai-service.js';
export * from './llm-adapter.js';
export * from './i18n-service.js';
// './workflow-service.js' removed (#4451, v17): IWorkflowService had no
// implementation and no `getService('workflow')` call site anywhere
// (ADR-0115 Evidence 5); the slot retired with it.

// CoreServiceName → contract map (#4127). Lets a slot lookup return the slot's
// contract instead of `any`, so a call outside it is a compile error.
export * from './core-service-contracts.js';

export * from './export-service.js';
export * from './email-service.js';
export * from './sms-service.js';
export * from './security-service.js';
export * from './sharing-service.js';
export * from './rls-membership-resolver.js';
export * from './share-link-service.js';
export * from './report-service.js';
export * from './approval-service.js';
export * from './package-service.js';
export * from './knowledge-service.js';
export * from './knowledge-adapter.js';
export * from './embedder.js';

// Provisioning & Deployment
// './provisioning-service.js' (IProvisioningService) and './tenant-router.js'
// (ITenantRouter / ResolvedTenantContext) removed (#4739, v17): both
// contracts had zero implementations and zero call sites in any repo
// (objectstack / cloud / objectui) — declared-only fiction over the
// system-side provisioning family retired in the same change (#4535 C16).
// The living provisioning contract is the `Provision*` family in
// `@objectstack/spec/cloud`, consumed by the cloud services (service-tenant).
export * from './schema-diff-service.js';
export * from './external-datasource-service.js';
export * from './deploy-pipeline-service.js';
export * from './app-lifecycle-service.js';
export * from './seed-loader-service.js';
export * from './seed-settlement.js';
export * from './crypto-provider.js';
export * from './cluster-service.js';
