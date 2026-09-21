// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { EvaluatedExpressionInputSchema } from '../shared/expression.zod';

/**
 * # Plugin Security and Sandboxing Protocol
 * 
 * Defines comprehensive security mechanisms for plugin isolation, permission
 * management, and threat protection in the ObjectStack ecosystem.
 * 
 * Features:
 * - Fine-grained permission system
 * - Resource access control
 * - Sandboxing and isolation
 * - Runtime security monitoring
 *
 * ⛔ NOT security scanning. The scan-result family — `KernelSecurityScanResult`,
 * `KernelSecurityVulnerability`, `PluginSecurityManifest.scanResults` and its
 * sibling list `.vulnerabilities` — was retired under ADR-0049 enforce-or-remove
 * (#15932), after the runtime scanner that was its last type-only importer went
 * the same way (#14919). Nothing on this platform scans a plugin.
 */

/**
 * Permission Scope
 * Defines the scope of a permission
 */
import { lazySchema } from '../shared/lazy-schema';
import { retiredKey } from '../shared/retired-key';
export const PermissionScopeSchema = lazySchema(() => z.enum([
  'global',      // Applies to entire system
  'tenant',      // Applies to specific tenant
  'user',        // Applies to specific user
  'resource',    // Applies to specific resource
  'plugin',      // Applies within plugin boundaries
]).describe('Scope of permission application'));

/**
 * Permission Action
 * Standard CRUD + extended actions
 */
export const PermissionActionSchema = lazySchema(() => z.enum([
  'create',      // Create new resources
  'read',        // Read existing resources
  'update',      // Update existing resources
  'delete',      // Delete resources
  'execute',     // Execute operations/functions
  'manage',      // Full management rights
  'configure',   // Configuration changes
  'share',       // Share with others
  'export',      // Export data
  'import',      // Import data
  'admin',       // Administrative access
]).describe('Type of action being permitted'));

/**
 * Resource Type
 * Types of resources that can be accessed
 */
export const ResourceTypeSchema = lazySchema(() => z.enum([
  'data.object',         // ObjectQL objects
  'data.record',         // Individual records
  'data.field',          // Specific fields
  'ui.view',            // UI views
  'ui.dashboard',       // Dashboards
  'ui.report',          // Reports
  'system.config',      // System configuration
  'system.plugin',      // Other plugins
  'system.api',         // API endpoints
  'system.service',     // System services
  'storage.file',       // File storage
  'storage.database',   // Database access
  'network.http',       // HTTP requests
  'network.websocket',  // WebSocket connections
  'process.spawn',      // Process spawning
  'process.env',        // Environment variables
]).describe('Type of resource being accessed'));

/**
 * Plugin Permission Definition
 * Defines a single plugin-sandbox permission requirement.
 *
 * NOTE: This is the plugin-sandbox permission descriptor, NOT the
 * runtime-editable `permission` metadata type. For the metadata protocol's
 * permission set (used by the `permission`/`profile` metadata types) see
 * {@link PermissionSetSchema} in `@objectstack/spec/security`.
 */
export const PluginPermissionSchema = lazySchema(() => z.object({
  /**
   * Permission identifier
   */
  id: z.string().describe('Unique permission identifier'),
  
  /**
   * Resource type
   */
  resource: ResourceTypeSchema,
  
  /**
   * Allowed actions
   */
  actions: z.array(PermissionActionSchema),
  
  /**
   * Permission scope
   */
  scope: PermissionScopeSchema.default('plugin'),
  
  /**
   * Resource filter
   */
  filter: z.object({
    /**
     * Specific resource IDs
     */
    resourceIds: z.array(z.string()).optional(),
    
    /**
     * Filter condition
     */
    condition: EvaluatedExpressionInputSchema.optional().describe('Predicate (CEL) filter, e.g. P`record.owner == os.user.id`.'),
    
    /**
     * Field-level access
     */
    fields: z.array(z.string()).optional().describe('Allowed fields for data resources'),
  }).optional(),
  
  /**
   * Human-readable description
   */
  description: z.string(),
  
  /**
   * Whether this permission is required or optional
   */
  required: z.boolean().default(true),
  
  /**
   * Justification for permission
   */
  justification: z.string().optional().describe('Why this permission is needed'),
}));

/**
 * Plugin Permission Set
 * Collection of plugin-sandbox permissions for a plugin.
 *
 * NOTE: This is distinct from the metadata protocol's `PermissionSetSchema`
 * in `@objectstack/spec/security` (the runtime-editable `permission`/`profile`
 * metadata type). This one describes what a plugin is allowed to do.
 */
export const PluginPermissionSetSchema = lazySchema(() => z.object({
  /**
   * All permissions required by plugin
   */
  permissions: z.array(PluginPermissionSchema),
  
  /**
   * Permission groups for easier management
   */
  groups: z.array(z.object({
    name: z.string().describe('Group name'),
    description: z.string(),
    permissions: z.array(z.string()).describe('Permission IDs in this group'),
  })).optional(),
  
  /**
   * Default grant strategy
   */
  defaultGrant: z.enum([
    'prompt',      // Always prompt user
    'allow',       // Allow by default
    'deny',        // Deny by default
    'inherit',     // Inherit from parent
  ]).default('prompt'),
}));

/**
 * Runtime Configuration
 * Defines the execution environment for plugin isolation
 */
// Declared ABOVE its consumer on purpose: `gen:schema` and
// `check:authorable-surface` run with `OS_EAGER_SCHEMAS=1`, which makes
// `lazySchema` evaluate the factory at module load, so a const declared after
// `RuntimeConfigSchema` would be read from its temporal dead zone. The four
// tombstone strings further down sit after their schemas for the same reason —
// every one of them is declared before the block that reads it.
const RUNTIME_RESOURCE_LIMITS_TIMEOUT_RETIRED =
  '`RuntimeConfig.resourceLimits.timeout` was renamed to `timeoutMs` in @objectstack/spec 17 — '
  + 'the unit of a duration-shaped number lives in the key name, not only in the describe prose. '
  + 'Its unit (milliseconds) lived in a source JSDoc only and the published description read '
  + '"Maximum execution time", naming no unit at all, so a reader of the reference page could '
  + 'not tell 60000 milliseconds from 60000 seconds. Rename the key to `timeoutMs`; the value '
  + '(milliseconds) is unchanged.';

export const RuntimeConfigSchema = lazySchema(() => z.object({
  /**
   * Runtime engine type
   */
  engine: z.enum([
    'v8-isolate',   // V8 isolate-based isolation (lightweight, fast)
    'wasm',         // WebAssembly-based isolation (secure, portable)
    'container',    // Container-based isolation (Docker, podman)
    'process',      // Process-based isolation (traditional)
  ]).default('v8-isolate')
    .describe('Execution environment engine'),
  
  /**
   * Engine-specific configuration
   */
  engineConfig: z.object({
    /**
     * WASM-specific settings (when engine is "wasm")
     */
    wasm: z.object({
      /**
       * Maximum memory pages (64KB per page)
       */
      maxMemoryPages: z.number().int().min(1).max(65536).optional()
        .describe('Maximum WASM memory pages (64KB each)'),
      
      /**
       * Instruction execution limit
       */
      instructionLimit: z.number().int().min(1).optional()
        .describe('Maximum instructions before timeout'),
      
      /**
       * Enable SIMD instructions
       */
      enableSimd: z.boolean().default(false)
        .describe('Enable WebAssembly SIMD support'),
      
      /**
       * Enable threads
       */
      enableThreads: z.boolean().default(false)
        .describe('Enable WebAssembly threads'),
      
      /**
       * Enable bulk memory operations
       */
      enableBulkMemory: z.boolean().default(true)
        .describe('Enable bulk memory operations'),
    }).optional(),
    
    /**
     * Container-specific settings (when engine is "container")
     */
    container: z.object({
      /**
       * Container image
       */
      image: z.string().optional()
        .describe('Container image to use'),
      
      /**
       * Container runtime
       */
      runtime: z.enum(['docker', 'podman', 'containerd']).default('docker'),
      
      /**
       * Resource limits
       */
      resources: z.object({
        cpuLimit: z.string().optional().describe('CPU limit (e.g., "0.5", "2")'),
        memoryLimit: z.string().optional().describe('Memory limit (e.g., "512m", "1g")'),
      }).optional(),
      
      /**
       * Network mode
       */
      networkMode: z.enum(['none', 'bridge', 'host']).default('bridge'),
    }).optional(),
    
    /**
     * V8 Isolate-specific settings (when engine is "v8-isolate")
     */
    v8Isolate: z.object({
      /**
       * Heap size limit in MB
       */
      heapSizeMb: z.number().int().min(1).optional(),
      
      /**
       * Enable snapshot
       */
      enableSnapshot: z.boolean().default(true),
    }).optional(),
  }).optional(),
  
  /**
   * General resource limits (applies to all engines)
   */
  resourceLimits: z.object({
    /**
     * Maximum memory in bytes
     */
    maxMemory: z.number().int().optional()
      .describe('Maximum memory allocation'),
    
    /**
     * Maximum CPU percentage
     */
    maxCpu: z.number().min(0).max(100).optional()
      .describe('Maximum CPU usage percentage'),
    
    /**
     * Execution timeout in milliseconds.
     *
     * Renamed from `timeout` (#15939 ruling A, executing #14478 ruling B): the
     * unit lived in this JSDoc only, and `.describe()` — the text
     * `content/docs/references/kernel/plugin-security-advanced.mdx` publishes —
     * read "Maximum execution time" and named none. Spelled `Ms`, the same
     * token `SandboxConfig.process.timeoutMs` on this file already carries.
     * Tombstoned rather than deleted because this nested `resourceLimits`
     * object is not `.strict()`.
     */
    timeoutMs: z.number().int().min(0).optional()
      .describe('Maximum execution time in milliseconds'),

    /** Tombstone for the rename above (#15939 ruling A, executing #14478). */
    timeout: retiredKey(RUNTIME_RESOURCE_LIMITS_TIMEOUT_RETIRED),
  }).optional(),
}));

const SANDBOX_PROCESS_TIMEOUT_RETIRED =
  '`SandboxConfig.process.timeout` was renamed to `timeoutMs` in @objectstack/spec 17 — '
  + 'the unit of a duration-shaped number lives in the key name, not only in the describe '
  + 'prose. Rename the key to `timeoutMs`; the value (milliseconds) is unchanged.';

const TOKEN_EXPIRATION_RETIRED =
  '`KernelSecurityPolicy.authentication.tokenExpiration` was renamed to '
  + '`tokenExpirationSeconds` in @objectstack/spec 17 — the unit of a duration-shaped number '
  + 'lives in the key name, not only in the describe prose, and the sibling rate-limit window '
  + 'on this same policy is already `windowMs`. Rename the key to `tokenExpirationSeconds`; '
  + 'the value (seconds) is unchanged.';

const AUDIT_LOG_RETENTION_RETIRED =
  '`KernelSecurityPolicy.auditLog.retention` was renamed to `retentionDays` in '
  + '@objectstack/spec 17 — the unit of a duration-shaped number lives in the key name, not '
  + 'only in the describe prose. Rename the key to `retentionDays`; the value (days) is '
  + 'unchanged.';

const DISCLOSURE_RESPONSE_TIME_RETIRED =
  '`PluginSecurityManifest.vulnerabilityDisclosure.responseTime` was renamed to '
  + '`responseTimeHours` in @objectstack/spec 17 — the unit of a duration-shaped number lives '
  + 'in the key name, not only in the describe prose. This one is HOURS, while the same bare '
  + 'name on `PluginHealthReport.metrics` was milliseconds — which is the confusion the rule '
  + 'exists to remove. Rename the key to `responseTimeHours`; the value (hours) is unchanged.';

// The scan-result family's two tombstones (#15932, ADR-0049 enforce-or-remove).
// Their value types — `KernelSecurityScanResult` and `KernelSecurityVulnerability` —
// are gone from this build entirely; see the header note above.
const SCAN_RESULTS_RETIRED =
  '`PluginSecurityManifest.scanResults` was removed in @objectstack/spec 17 (ADR-0049 '
  + 'enforce-or-remove) — nothing on this platform ever produced, stored or read a security '
  + 'scan result, so an authored array parsed cleanly and changed nothing. Delete the key. '
  + 'There is no replacement key: plugin security scanning is not a platform capability. What '
  + 'this manifest still enforces is `permissions` and `sandbox`; artifact provenance is '
  + 'answered by the plugin signature verifier, which tells you an artifact is the one its '
  + 'publisher signed and never that it is safe. Audit dependencies with a tool built for it '
  + '(npm audit, pnpm audit, Dependabot, the GitHub Advisory Database, OSV).';

const MANIFEST_VULNERABILITIES_RETIRED =
  '`PluginSecurityManifest.vulnerabilities` was removed in @objectstack/spec 17 (ADR-0049 '
  + 'enforce-or-remove) — it was an array of `KernelSecurityVulnerability`, the other half of '
  + 'the scan-result family, and leaves with it: nothing ever wrote the list and nothing ever '
  + 'read it, so declaring a known vulnerability against a plugin warned nobody and blocked '
  + 'no install. Delete the key. There is no replacement key: plugin security scanning is not '
  + 'a platform capability. Publish vulnerability contact and disclosure terms through the '
  + 'surviving `securityContact` and `vulnerabilityDisclosure` blocks on this same manifest, '
  + 'and audit dependencies with a tool built for it (npm audit, pnpm audit, Dependabot, the '
  + 'GitHub Advisory Database, OSV).';

/**
 * Sandbox Configuration
 * Defines how plugin is isolated
 */
export const SandboxConfigSchema = lazySchema(() => z.object({
  /**
   * Enable sandboxing
   */
  enabled: z.boolean().default(true),
  
  /**
   * Sandboxing level
   */
  level: z.enum([
    'none',        // No sandboxing
    'minimal',     // Basic isolation
    'standard',    // Standard sandboxing
    'strict',      // Strict isolation
    'paranoid',    // Maximum isolation
  ]).default('standard'),
  
  /**
   * Runtime environment configuration
   */
  runtime: RuntimeConfigSchema.optional()
    .describe('Execution environment and isolation settings'),
  
  /**
   * File system access
   */
  filesystem: z.object({
    mode: z.enum(['none', 'readonly', 'restricted', 'full']).default('restricted'),
    allowedPaths: z.array(z.string()).optional().describe('Whitelisted paths'),
    deniedPaths: z.array(z.string()).optional().describe('Blacklisted paths'),
    maxFileSize: z.number().int().optional().describe('Maximum file size in bytes'),
  }).optional(),
  
  /**
   * Network access
   */
  network: z.object({
    mode: z.enum(['none', 'local', 'restricted', 'full']).default('restricted'),
    allowedHosts: z.array(z.string()).optional().describe('Whitelisted hosts'),
    deniedHosts: z.array(z.string()).optional().describe('Blacklisted hosts'),
    allowedPorts: z.array(z.number()).optional().describe('Allowed port numbers'),
    maxConnections: z.number().int().optional(),
  }).optional(),
  
  /**
   * Process execution
   */
  process: z.object({
    allowSpawn: z.boolean().default(false).describe('Allow spawning child processes'),
    allowedCommands: z.array(z.string()).optional().describe('Whitelisted commands'),
    // Renamed from `timeout` (#15678, #14478 ruling B): the unit lived only in
    // the describe prose.
    timeoutMs: z.number().int().optional().describe('Process timeout in ms'),

    /** Tombstone for the rename above (#15678, ruling B on #14478). */
    timeout: retiredKey(SANDBOX_PROCESS_TIMEOUT_RETIRED),
  }).optional(),
  
  /**
   * Memory limits
   */
  memory: z.object({
    maxHeap: z.number().int().optional().describe('Maximum heap size in bytes'),
    maxStack: z.number().int().optional().describe('Maximum stack size in bytes'),
  }).optional(),
  
  /**
   * CPU limits
   */
  cpu: z.object({
    maxCpuPercent: z.number().min(0).max(100).optional(),
    maxThreads: z.number().int().optional(),
  }).optional(),
  
  /**
   * Environment variables
   */
  environment: z.object({
    mode: z.enum(['none', 'readonly', 'restricted', 'full']).default('readonly'),
    allowedVars: z.array(z.string()).optional(),
    deniedVars: z.array(z.string()).optional(),
  }).optional(),
}));

/**
 * Security Policy
 * Defines security policies for plugin
 */
export const KernelSecurityPolicySchema = lazySchema(() => z.object({
  /**
   * Content Security Policy
   */
  csp: z.object({
    directives: z.record(z.string(), z.array(z.string())).optional(),
    reportOnly: z.boolean().default(false),
  }).optional(),
  
  /**
   * CORS policy
   */
  cors: z.object({
    allowedOrigins: z.array(z.string()),
    allowedMethods: z.array(z.string()),
    allowedHeaders: z.array(z.string()),
    allowCredentials: z.boolean().default(false),
    // `externalVocabulary` mirror (#14478 ruling B), the same declaration its
    // twin `CorsConfig.maxAge` (`src/shared/http.zod.ts`) already carries: this
    // key IS the CORS `Access-Control-Max-Age` response header, whose value the
    // standard defines in seconds. Renaming it to `maxAgeSeconds` would break the
    // one-to-one reading between this policy and the header it emits.
    maxAge: z.number().int().optional().describe('Preflight cache duration in seconds')
      .meta({ externalVocabulary: 'CORS `Access-Control-Max-Age` (WHATWG Fetch)' }),
  }).optional(),
  
  /**
   * Rate limiting
   */
  rateLimit: z.object({
    enabled: z.boolean().default(true),
    maxRequests: z.number().int(),
    windowMs: z.number().int().describe('Time window in milliseconds'),
    strategy: z.enum(['fixed', 'sliding', 'token-bucket']).default('sliding'),
  }).optional(),
  
  /**
   * Authentication requirements
   */
  authentication: z.object({
    required: z.boolean().default(true),
    methods: z.array(z.enum(['jwt', 'oauth2', 'api-key', 'session', 'certificate'])),
    // Renamed from `tokenExpiration` (#15678, #14478 ruling B): the unit lived
    // only in the describe prose, beside the already-suffixed `windowMs`.
    tokenExpirationSeconds: z.number().int().optional().describe('Token expiration in seconds'),

    /** Tombstone for the rename above (#15678, ruling B on #14478). */
    tokenExpiration: retiredKey(TOKEN_EXPIRATION_RETIRED),
  }).optional(),
  
  /**
   * Encryption requirements
   */
  encryption: z.object({
    dataAtRest: z.boolean().default(false).describe('Encrypt data at rest'),
    dataInTransit: z.boolean().default(true).describe('Enforce HTTPS/TLS'),
    algorithm: z.string().optional().describe('Encryption algorithm'),
    minKeyLength: z.number().int().optional().describe('Minimum key length in bits'),
  }).optional(),
  
  /**
   * Audit logging
   */
  auditLog: z.object({
    enabled: z.boolean().default(true),
    events: z.array(z.string()).optional().describe('Events to log'),
    // Renamed from `retention` (#15678, #14478 ruling B): the unit lived only in
    // the describe prose.
    retentionDays: z.number().int().optional().describe('Log retention in days'),

    /** Tombstone for the rename above (#15678, ruling B on #14478). */
    retention: retiredKey(AUDIT_LOG_RETENTION_RETIRED),
  }).optional(),
}));

/**
 * Plugin Trust Level
 * Indicates trust level of plugin
 */
export const PluginTrustLevelSchema = lazySchema(() => z.enum([
  'verified',      // Official/verified plugin
  'trusted',       // Trusted third-party
  'community',     // Community plugin
  'untrusted',     // Unverified plugin
  'blocked',       // Blocked/malicious
]).describe('Trust level of the plugin'));

/**
 * Plugin Security Manifest
 * Complete security information for plugin
 */
export const PluginSecurityManifestSchema = lazySchema(() => z.object({
  /**
   * Plugin identifier
   */
  pluginId: z.string(),
  
  /**
   * Trust level
   */
  trustLevel: PluginTrustLevelSchema,
  
  /**
   * Required permissions
   */
  permissions: PluginPermissionSetSchema,
  
  /**
   * Sandbox configuration
   */
  sandbox: SandboxConfigSchema,
  
  /**
   * Security policy
   */
  policy: KernelSecurityPolicySchema.optional(),
  
  /**
   * Tombstone: the scan-result surface is RETIRED (#15932, ADR-0049
   * enforce-or-remove). `KernelSecurityScanResult` and
   * `KernelSecurityVulnerability` left this build with it — the last importer
   * of either type went with `PluginSecurityScanner` (#14919). Not a bare
   * deletion: this shape is not `.strict()`, so zod would strip an authored
   * key in silence (ADR-0104).
   */
  scanResults: retiredKey(SCAN_RESULTS_RETIRED),

  /** Tombstone for the sibling list — same retirement, same reasoning. */
  vulnerabilities: retiredKey(MANIFEST_VULNERABILITIES_RETIRED),
  
  /**
   * Code signing
   */
  codeSigning: z.object({
    signed: z.boolean(),
    signature: z.string().optional(),
    certificate: z.string().optional(),
    algorithm: z.string().optional(),
    timestamp: z.string().datetime().optional(),
  }).optional(),
  
  /**
   * Security certifications
   */
  certifications: z.array(z.object({
    name: z.string().describe('Certification name (e.g., SOC 2, ISO 27001)'),
    issuer: z.string(),
    issuedDate: z.string().datetime(),
    expiryDate: z.string().datetime().optional(),
    certificateUrl: z.string().url().optional(),
  })).optional(),
  
  /**
   * Security contact
   */
  securityContact: z.object({
    email: z.string().email().optional(),
    url: z.string().url().optional(),
    pgpKey: z.string().optional(),
  }).optional(),
  
  /**
   * Vulnerability disclosure policy
   */
  vulnerabilityDisclosure: z.object({
    policyUrl: z.string().url().optional(),
    // Renamed from `responseTime` (#15678, #14478 ruling B): the unit lived only
    // in the describe prose — and it is HOURS here, while the same bare name on
    // PluginHealthReport.metrics was milliseconds.
    responseTimeHours: z.number().int().optional().describe('Expected response time in hours'),

    /** Tombstone for the rename above (#15678, ruling B on #14478). */
    responseTime: retiredKey(DISCLOSURE_RESPONSE_TIME_RETIRED),
    bugBounty: z.boolean().default(false),
  }).optional(),
}));

// Export types
export type PermissionScope = z.input<typeof PermissionScopeSchema>;
export type PermissionAction = z.input<typeof PermissionActionSchema>;
export type ResourceType = z.input<typeof ResourceTypeSchema>;
export type PluginPermission = z.input<typeof PluginPermissionSchema>;
/** Post-parse shape of {@link PluginPermission} — defaults applied, transforms run (ADR-0122). */
export type PluginPermissionParsed = z.infer<typeof PluginPermissionSchema>;
export type PluginPermissionSet = z.input<typeof PluginPermissionSetSchema>;
/** Post-parse shape of {@link PluginPermissionSet} — defaults applied, transforms run (ADR-0122). */
export type PluginPermissionSetParsed = z.infer<typeof PluginPermissionSetSchema>;
export type RuntimeConfig = z.input<typeof RuntimeConfigSchema>;
/** Post-parse shape of {@link RuntimeConfig} — defaults applied, transforms run (ADR-0122). */
export type RuntimeConfigParsed = z.infer<typeof RuntimeConfigSchema>;
export type SandboxConfig = z.input<typeof SandboxConfigSchema>;
/** Post-parse shape of {@link SandboxConfig} — defaults applied, transforms run (ADR-0122). */
export type SandboxConfigParsed = z.infer<typeof SandboxConfigSchema>;
export type KernelSecurityPolicy = z.input<typeof KernelSecurityPolicySchema>;
/** Post-parse shape of {@link KernelSecurityPolicy} — defaults applied, transforms run (ADR-0122). */
export type KernelSecurityPolicyParsed = z.infer<typeof KernelSecurityPolicySchema>;
export type PluginTrustLevel = z.input<typeof PluginTrustLevelSchema>;
export type PluginSecurityManifest = z.input<typeof PluginSecurityManifestSchema>;
/** Post-parse shape of {@link PluginSecurityManifest} — defaults applied, transforms run (ADR-0122). */
export type PluginSecurityManifestParsed = z.infer<typeof PluginSecurityManifestSchema>;
