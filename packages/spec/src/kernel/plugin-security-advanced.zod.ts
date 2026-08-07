// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ExpressionInputSchema } from '../shared/expression.zod';

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
 * - Security scanning and verification
 * - Runtime security monitoring
 */

/**
 * Permission Scope
 * Defines the scope of a permission
 */
import { lazySchema } from '../shared/lazy-schema';
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
    condition: ExpressionInputSchema.optional().describe('Predicate (CEL) filter, e.g. P`record.owner == os.user.id`.'),
    
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
     * Execution timeout in milliseconds
     */
    timeout: z.number().int().min(0).optional()
      .describe('Maximum execution time'),
  }).optional(),
}));

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
    timeout: z.number().int().optional().describe('Process timeout in ms'),
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
 * Security Vulnerability
 * Represents a known security vulnerability
 */
export const KernelSecurityVulnerabilitySchema = lazySchema(() => z.object({
  /**
   * CVE identifier
   */
  cve: z.string().optional(),
  
  /**
   * Vulnerability identifier
   */
  id: z.string(),
  
  /**
   * Severity level
   */
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  
  /**
   * Category (e.g., SAST, DAST, Dependency)
   */
  category: z.string().optional(),

  /**
   * Title
   */
  title: z.string(),
  
  /**
   * Location of the vulnerability
   */
  location: z.string().optional(),

  /**
   * Remediation steps
   */
  remediation: z.string().optional(),

  /**
   * Description
   */
  description: z.string(),
  
  /**
   * Affected versions
   */
  affectedVersions: z.array(z.string()),
  
  /**
   * Fixed in versions
   */
  fixedIn: z.array(z.string()).optional(),
  
  /**
   * CVSS score
   */
  cvssScore: z.number().min(0).max(10).optional(),
  
  /**
   * Exploit availability
   */
  exploitAvailable: z.boolean().default(false),
  
  /**
   * Patch available
   */
  patchAvailable: z.boolean().default(false),
  
  /**
   * Workaround
   */
  workaround: z.string().optional(),
  
  /**
   * References
   */
  references: z.array(z.string()).optional(),
  
  /**
   * Discovered date
   */
  discoveredDate: z.string().datetime().optional(),
  
  /**
   * Published date
   */
  publishedDate: z.string().datetime().optional(),
}));

/**
 * Security Scan Result
 * Result of security scanning
 */
export const KernelSecurityScanResultSchema = lazySchema(() => z.object({
  /**
   * Scan timestamp
   */
  timestamp: z.string().datetime(),
  
  /**
   * Scanner information
   */
  scanner: z.object({
    name: z.string(),
    version: z.string(),
  }),
  
  /**
   * Overall status
   */
  status: z.enum(['passed', 'failed', 'warning']),
  
  /**
   * Vulnerabilities found
   */
  vulnerabilities: z.array(KernelSecurityVulnerabilitySchema).optional(),
  
  /**
   * Code quality issues
   */
  codeIssues: z.array(z.object({
    severity: z.enum(['error', 'warning', 'info']),
    type: z.string().describe('Issue type (e.g., sql-injection, xss)'),
    file: z.string(),
    line: z.number().int().optional(),
    message: z.string(),
    suggestion: z.string().optional(),
  })).optional(),
  
  /**
   * Dependency vulnerabilities
   */
  dependencyVulnerabilities: z.array(z.object({
    package: z.string(),
    version: z.string(),
    vulnerability: KernelSecurityVulnerabilitySchema,
  })).optional(),
  
  /**
   * License compliance
   */
  licenseCompliance: z.object({
    status: z.enum(['compliant', 'non-compliant', 'unknown']),
    issues: z.array(z.object({
      package: z.string(),
      license: z.string(),
      reason: z.string(),
    })).optional(),
  }).optional(),
  
  /**
   * Summary statistics
   */
  summary: z.object({
    totalVulnerabilities: z.number().int(),
    criticalCount: z.number().int(),
    highCount: z.number().int(),
    mediumCount: z.number().int(),
    lowCount: z.number().int(),
    infoCount: z.number().int(),
  }),
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
    maxAge: z.number().int().optional(),
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
    tokenExpiration: z.number().int().optional().describe('Token expiration in seconds'),
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
    retention: z.number().int().optional().describe('Log retention in days'),
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
   * Security scan results
   */
  scanResults: z.array(KernelSecurityScanResultSchema).optional(),
  
  /**
   * Known vulnerabilities
   */
  vulnerabilities: z.array(KernelSecurityVulnerabilitySchema).optional(),
  
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
    responseTime: z.number().int().optional().describe('Expected response time in hours'),
    bugBounty: z.boolean().default(false),
  }).optional(),
}));

// Export types
export type PermissionScope = z.infer<typeof PermissionScopeSchema>;
export type PermissionAction = z.infer<typeof PermissionActionSchema>;
export type ResourceType = z.infer<typeof ResourceTypeSchema>;
export type PluginPermission = z.infer<typeof PluginPermissionSchema>;
/** Post-parse shape of {@link PluginPermission} — defaults applied, transforms run (ADR-0122). */
export type PluginPermissionParsed = z.infer<typeof PluginPermissionSchema>;
export type PluginPermissionSet = z.infer<typeof PluginPermissionSetSchema>;
/** Post-parse shape of {@link PluginPermissionSet} — defaults applied, transforms run (ADR-0122). */
export type PluginPermissionSetParsed = z.infer<typeof PluginPermissionSetSchema>;
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
/** Post-parse shape of {@link RuntimeConfig} — defaults applied, transforms run (ADR-0122). */
export type RuntimeConfigParsed = z.infer<typeof RuntimeConfigSchema>;
export type SandboxConfig = z.infer<typeof SandboxConfigSchema>;
/** Post-parse shape of {@link SandboxConfig} — defaults applied, transforms run (ADR-0122). */
export type SandboxConfigParsed = z.infer<typeof SandboxConfigSchema>;
export type KernelSecurityVulnerability = z.infer<typeof KernelSecurityVulnerabilitySchema>;
/** Post-parse shape of {@link KernelSecurityVulnerability} — defaults applied, transforms run (ADR-0122). */
export type KernelSecurityVulnerabilityParsed = z.infer<typeof KernelSecurityVulnerabilitySchema>;
export type KernelSecurityScanResult = z.infer<typeof KernelSecurityScanResultSchema>;
/** Post-parse shape of {@link KernelSecurityScanResult} — defaults applied, transforms run (ADR-0122). */
export type KernelSecurityScanResultParsed = z.infer<typeof KernelSecurityScanResultSchema>;
export type KernelSecurityPolicy = z.infer<typeof KernelSecurityPolicySchema>;
/** Post-parse shape of {@link KernelSecurityPolicy} — defaults applied, transforms run (ADR-0122). */
export type KernelSecurityPolicyParsed = z.infer<typeof KernelSecurityPolicySchema>;
export type PluginTrustLevel = z.infer<typeof PluginTrustLevelSchema>;
export type PluginSecurityManifest = z.infer<typeof PluginSecurityManifestSchema>;
/** Post-parse shape of {@link PluginSecurityManifest} — defaults applied, transforms run (ADR-0122). */
export type PluginSecurityManifestParsed = z.infer<typeof PluginSecurityManifestSchema>;
