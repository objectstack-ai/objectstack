// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * System Protocol Exports
 * 
 * Runtime Services & Infrastructure Configuration
 * - Infrastructure: Cache, Queue, Storage, Search, HTTP
 * - Observability: Audit, Logging, Metrics, Tracing, Change Management
 * - Security: Compliance, Encryption, Masking, Auth Config
 * - Services: Job, Worker, Notification, Translation
 */

// Infrastructure Services
export * from './cache.zod';
export * from './disaster-recovery.zod';
export * from './message-queue.zod';
export * from './object-storage.zod';
export * from './search-engine.zod';
export * from './http-server.zod';

// Observability & Operations
// audit.zod (AuditConfig/AuditStorageConfig/AuditRetentionPolicy/AuditEventFilter/
// SuspiciousActivityRule + the AuditEvent* shape schemas) was REMOVED per ADR-0056
// D8 "design+enforce or remove": the whole module had zero consumers — the LIVE
// audit path (plugin-audit) captures unconditionally via engine hooks and defines
// its own sys_audit_log row shape, and `AuditConfigSchema.enabled` contradicted
// the always-on compliance-ledger contract (object.zod `trackHistory`). The
// enforced authoring surface is object/field `trackHistory` + the object
// `lifecycle` `audit` category (retention), with per-org overrides in settings.
export * from './logging.zod';
export * from './metrics.zod';
export * from './tracing.zod';
export * from './change-management.zod';
export * from './migration.zod';

// Security & Compliance
export * from './auth-config.zod';
export * from './doc.zod';
export * from './book.zod';
export * from './email-config.zod';
export * from './email-template.zod';
export * from './email-template.form';
export * from './metadata-form-registry';
// compliance.zod (GDPR/HIPAA/PCI configs) and masking.zod (role-based data
// masking) were REMOVED per ADR-0056 D8 "design+enforce or remove": both were
// declared-but-never-enforced (no runtime consumer), and compliance-grade
// configuration must never merely LOOK live. FLS (plugin-security) is the
// enforced field-visibility mechanism; a masking/deny layer arrives with
// ADR-0066 ⑦/⑧ if needed. encryption.zod stays (EXPERIMENTAL — roadmap).
export * from './encryption.zod';
export * from './security-context.zod';
export * from './incident-response.zod';
export * from './supplier-security.zod';
export * from './training.zod';

// Settings (ADR-0007: Manifest + K/V Store + Resolver)
export * from './settings-manifest.zod';
export * from './settings-client.zod';

// Runtime Services
export * from './job.zod';
export * from './worker.zod';
export * from './notification.zod';
export * from './translation.zod';
export * from './i18n-resolver';
// Localized templates for the built-in field-validation messages (#3957).
export * from './validation-message';
export * from './translation-typegen';
export * from './translation-skeleton';
export * from './collaboration.zod';
export * from './metadata-persistence.zod';
export * from './core-services.zod';

// Multi-Tenant & Licensing
export * from './tenant.zod';
export * from './license.zod';
export * from './registry-config.zod';

// Provisioning & Deployment
export * from './provisioning.zod';
export * from './deploy-bundle.zod';
export * from './app-install.zod';
export * from './environment-artifact.zod';

// Constants
export * from './constants';

// `./types` (the `ObjectStackPlugin` lifecycle interface and its
// `PluginContext` / `PluginLogger` / `ObjectQLClient` / `IKernel` /
// `ObjectOSKernel` companions) was retired in #4212: it described an
// `onInstall`/`onEnable`/`onDisable` contract the kernel never implemented —
// the real plugin contract is `init`/`start`/`destroy` in
// `packages/core/src/types.ts` — and nothing in any repo imported it. It was
// seeded by the aspirational spec in issue #2 and survived as fiction.
