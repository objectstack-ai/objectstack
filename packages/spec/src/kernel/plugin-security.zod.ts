// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Plugin Security & Dependency Resolution Protocol
 * 
 * Provides comprehensive security scanning, vulnerability management,
 * and dependency resolution for the ObjectStack plugin ecosystem.
 * 
 * Features:
 * - CVE/vulnerability scanning
 * - Dependency graph resolution
 * - Semantic version conflict detection
 * - Supply chain security
 * - Plugin sandboxing policies
 * - Trust and verification workflows
 */

// ============================================================================
// Security Scanning
// ============================================================================

/**
 * Vulnerability Severity
 */
import { lazySchema } from '../shared/lazy-schema';
export const VulnerabilitySeverity = z.enum([
  'critical',
  'high',
  'medium',
  'low',
  'info',
]).describe('Severity level of a security vulnerability');

export type VulnerabilitySeverity = z.infer<typeof VulnerabilitySeverity>;

/**
 * Security Vulnerability
 */
export const SecurityVulnerabilitySchema = lazySchema(() => z.object({
  /**
   * CVE identifier (if applicable)
   */
  cve: z.string().regex(/^CVE-\d{4}-\d+$/).optional().describe('CVE identifier'),
  
  /**
   * Vulnerability identifier (GHSA, SNYK, etc.)
   */
  id: z.string().describe('Vulnerability ID'),
  
  /**
   * Title
   */
  title: z.string().describe('Short title summarizing the vulnerability'),
  
  /**
   * Description
   */
  description: z.string().describe('Detailed description of the vulnerability'),
  
  /**
   * Severity
   */
  severity: VulnerabilitySeverity.describe('Severity level of this vulnerability'),
  
  /**
   * CVSS score (0-10)
   */
  cvss: z.number().min(0).max(10).optional().describe('CVSS score ranging from 0 to 10'),
  
  /**
   * Affected package
   */
  package: z.object({
    name: z.string().describe('Name of the affected package'),
    version: z.string().describe('Version of the affected package'),
    ecosystem: z.string().optional().describe('Package ecosystem (e.g., npm, pip, maven)'),
  }).describe('Affected package information'),
  
  /**
   * Vulnerable version range
   */
  vulnerableVersions: z.string().describe('Semver range of vulnerable versions'),
  
  /**
   * Patched versions
   */
  patchedVersions: z.string().optional().describe('Semver range of patched versions'),
  
  /**
   * References
   */
  references: z.array(z.object({
    type: z.enum(['advisory', 'article', 'report', 'web']).describe('Type of reference source'),
    url: z.string().url().describe('URL of the reference'),
  })).default([]).describe('External references related to the vulnerability'),
  
  /**
   * CWE (Common Weakness Enumeration)
   */
  cwe: z.array(z.string()).default([]).describe('CWE identifiers associated with this vulnerability'),
  
  /**
   * Published date
   */
  publishedAt: z.string().datetime().optional().describe('ISO 8601 date when the vulnerability was published'),
  
  /**
   * Mitigation advice
   */
  mitigation: z.string().optional().describe('Recommended steps to mitigate the vulnerability'),
}).describe('A known security vulnerability in a package dependency'));

export type SecurityVulnerability = z.infer<typeof SecurityVulnerabilitySchema>;
/** Post-parse shape of {@link SecurityVulnerability} — defaults applied, transforms run (ADR-0122). */
export type SecurityVulnerabilityParsed = z.infer<typeof SecurityVulnerabilitySchema>;

/**
 * Security Scan Result
 */
export const SecurityScanResultSchema = lazySchema(() => z.object({
  /**
   * Scan identifier
   */
  scanId: z.string().uuid().describe('Unique identifier for this security scan'),
  
  /**
   * Plugin being scanned
   */
  plugin: z.object({
    id: z.string().describe('Plugin identifier'),
    version: z.string().describe('Plugin version that was scanned'),
  }).describe('Plugin that was scanned'),
  
  /**
   * Scan timestamp
   */
  scannedAt: z.string().datetime().describe('ISO 8601 timestamp when the scan was performed'),
  
  /**
   * Scanner information
   */
  scanner: z.object({
    name: z.string().describe('Scanner name (e.g., snyk, osv, trivy)'),
    version: z.string().describe('Version of the scanner tool'),
  }).describe('Information about the scanner tool used'),
  
  /**
   * Scan status
   */
  status: z.enum(['passed', 'failed', 'warning']).describe('Overall result status of the security scan'),
  
  /**
   * Vulnerabilities found
   */
  vulnerabilities: z.array(SecurityVulnerabilitySchema).describe('List of vulnerabilities discovered during the scan'),
  
  /**
   * Vulnerability summary
   */
  summary: z.object({
    critical: z.number().int().min(0).default(0).describe('Count of critical severity vulnerabilities'),
    high: z.number().int().min(0).default(0).describe('Count of high severity vulnerabilities'),
    medium: z.number().int().min(0).default(0).describe('Count of medium severity vulnerabilities'),
    low: z.number().int().min(0).default(0).describe('Count of low severity vulnerabilities'),
    info: z.number().int().min(0).default(0).describe('Count of informational severity vulnerabilities'),
    total: z.number().int().min(0).default(0).describe('Total count of all vulnerabilities'),
  }).describe('Summary counts of vulnerabilities by severity'),
  
  /**
   * License compliance issues
   */
  licenseIssues: z.array(z.object({
    package: z.string().describe('Name of the package with a license issue'),
    license: z.string().describe('License identifier of the package'),
    reason: z.string().describe('Reason the license is flagged'),
    severity: z.enum(['error', 'warning', 'info']).describe('Severity of the license compliance issue'),
  })).default([]).describe('License compliance issues found during the scan'),
  
  /**
   * Code quality issues
   */
  codeQuality: z.object({
    score: z.number().min(0).max(100).optional().describe('Overall code quality score from 0 to 100'),
    issues: z.array(z.object({
      type: z.enum(['security', 'quality', 'style']).describe('Category of the code quality issue'),
      severity: z.enum(['error', 'warning', 'info']).describe('Severity of the code quality issue'),
      message: z.string().describe('Description of the code quality issue'),
      file: z.string().optional().describe('File path where the issue was found'),
      line: z.number().int().optional().describe('Line number where the issue was found'),
    })).default([]).describe('List of individual code quality issues'),
  }).optional().describe('Code quality analysis results'),
  
  /**
   * Next scan scheduled
   */
  nextScanAt: z.string().datetime().optional().describe('ISO 8601 timestamp for the next scheduled scan'),
}).describe('Result of a security scan performed on a plugin'));

export type SecurityScanResult = z.infer<typeof SecurityScanResultSchema>;
/** Post-parse shape of {@link SecurityScanResult} — defaults applied, transforms run (ADR-0122). */
export type SecurityScanResultParsed = z.infer<typeof SecurityScanResultSchema>;

/**
 * Security Policy
 */
export const SecurityPolicySchema = lazySchema(() => z.object({
  /**
   * Policy identifier
   */
  id: z.string().describe('Unique identifier for the security policy'),
  
  /**
   * Policy name
   */
  name: z.string().describe('Human-readable name of the security policy'),
  
  /**
   * Automatic scanning
   */
  autoScan: z.object({
    enabled: z.boolean().default(true).describe('Whether automatic scanning is enabled'),
    frequency: z.enum(['on-publish', 'daily', 'weekly', 'monthly']).default('daily').describe('How often automatic scans are performed'),
  }).describe('Automatic security scanning configuration'),
  
  /**
   * Vulnerability thresholds
   */
  thresholds: z.object({
    /**
     * Block plugin if critical vulnerabilities exceed this
     */
    maxCritical: z.number().int().min(0).default(0).describe('Maximum allowed critical vulnerabilities before blocking'),
    
    /**
     * Block plugin if high vulnerabilities exceed this
     */
    maxHigh: z.number().int().min(0).default(0).describe('Maximum allowed high vulnerabilities before blocking'),
    
    /**
     * Warn if medium vulnerabilities exceed this
     */
    maxMedium: z.number().int().min(0).default(5).describe('Maximum allowed medium vulnerabilities before warning'),
  }).describe('Vulnerability count thresholds for policy enforcement'),
  
  /**
   * Allowed licenses
   */
  allowedLicenses: z.array(z.string()).default([
    'MIT',
    'Apache-2.0',
    'BSD-3-Clause',
    'BSD-2-Clause',
    'ISC',
  ]).describe('List of SPDX license identifiers that are permitted'),
  
  /**
   * Prohibited licenses
   */
  prohibitedLicenses: z.array(z.string()).default([
    'GPL-3.0',
    'AGPL-3.0',
  ]).describe('List of SPDX license identifiers that are prohibited'),
  
  /**
   * Code signing requirements
   */
  codeSigning: z.object({
    required: z.boolean().default(false).describe('Whether code signing is required for plugins'),
    allowedSigners: z.array(z.string()).default([]).describe('List of trusted signer identities'),
  }).optional().describe('Code signing requirements for plugin artifacts'),
  
  /**
   * Sandbox restrictions
   */
  sandbox: z.object({
    /**
     * Restrict network access
     */
    networkAccess: z.enum(['none', 'localhost', 'allowlist', 'all']).default('all').describe('Level of network access granted to the plugin'),
    
    /**
     * Allowed network destinations (if allowlist)
     */
    allowedDestinations: z.array(z.string()).default([]).describe('Permitted network destinations when using allowlist mode'),
    
    /**
     * File system access
     */
    filesystemAccess: z.enum(['none', 'read-only', 'temp-only', 'full']).default('full').describe('Level of file system access granted to the plugin'),
    
    /**
     * Maximum memory (MB)
     */
    maxMemoryMB: z.number().int().positive().optional().describe('Maximum memory allocation in megabytes'),
    
    /**
     * Maximum CPU time (seconds)
     */
    maxCPUSeconds: z.number().int().positive().optional().describe('Maximum CPU time allowed in seconds'),
  }).optional().describe('Sandbox restrictions for plugin execution'),
}).describe('Security policy governing plugin scanning and enforcement'));

export type SecurityPolicy = z.infer<typeof SecurityPolicySchema>;
/** Post-parse shape of {@link SecurityPolicy} — defaults applied, transforms run (ADR-0122). */
export type SecurityPolicyParsed = z.infer<typeof SecurityPolicySchema>;

// ============================================================================
// Dependency Resolution
// ============================================================================

/**
 * Resolved Package Dependency — one edge of the resolver's dependency graph.
 *
 * This is the RESOLVER-side shape: what the dependency resolver works with
 * while it walks a graph (`DependencyGraphNodeSchema.dependencies`) and what
 * `PluginSecurityProtocol` publishes for SBOM/conflict reporting. It carries
 * the resolution outcome (`resolvedVersion`) alongside the constraint.
 *
 * Do NOT confuse it with `PackageDependency` from `@objectstack/spec/cloud`
 * (`cloud/package-version.zod.ts`), which is the DECLARATION-side shape an
 * author writes into a package manifest (`packageId` / `versionRange` /
 * `optional`). Until #4741 both were named `PackageDependency` and the two
 * key sets are entirely disjoint, so which type a consumer got depended on
 * nothing but the import path — the #4411 trap. ADR-0112 D9(a) renamed this,
 * the resolver side; the manifest side keeps the bare name.
 */
export const ResolvedPackageDependencySchema = lazySchema(() => z.object({
  /**
   * Package name/ID
   */
  name: z.string().describe('Package name or identifier'),

  /**
   * Version constraint (semver range)
   */
  versionConstraint: z.string().describe('Semver range (e.g., `^1.0.0`, `>=2.0.0 <3.0.0`)'),

  /**
   * Dependency type
   */
  type: z.enum(['required', 'optional', 'peer', 'dev']).default('required').describe('Category of the dependency relationship'),

  /**
   * Resolved version (filled during resolution)
   */
  resolvedVersion: z.string().optional().describe('Concrete version resolved during dependency resolution'),
}).describe('A resolver-side package dependency: version constraint plus its resolution outcome'));

export type ResolvedPackageDependency = z.infer<typeof ResolvedPackageDependencySchema>;
/** Post-parse shape of {@link ResolvedPackageDependency} — defaults applied, transforms run (ADR-0122). */
export type ResolvedPackageDependencyParsed = z.infer<typeof ResolvedPackageDependencySchema>;

/**
 * Dependency Graph Node
 */
export const DependencyGraphNodeSchema = lazySchema(() => z.object({
  /**
   * Package identifier
   */
  id: z.string().describe('Unique identifier of the package'),
  
  /**
   * Package version
   */
  version: z.string().describe('Resolved version of the package'),
  
  /**
   * Dependencies of this package
   */
  dependencies: z.array(ResolvedPackageDependencySchema).default([]).describe('Dependencies required by this package'),
  
  /**
   * Depth in dependency tree
   */
  depth: z.number().int().min(0).describe('Depth level in the dependency tree (0 = root)'),
  
  /**
   * Whether this is a direct dependency
   */
  isDirect: z.boolean().describe('Whether this is a direct (top-level) dependency'),
  
  /**
   * Package metadata
   */
  metadata: z.object({
    name: z.string().describe('Display name of the package'),
    description: z.string().optional().describe('Short description of the package'),
    license: z.string().optional().describe('SPDX license identifier of the package'),
    homepage: z.string().url().optional().describe('Homepage URL of the package'),
  }).optional().describe('Additional metadata about the package'),
}).describe('A node in the dependency graph representing a resolved package'));

export type DependencyGraphNode = z.infer<typeof DependencyGraphNodeSchema>;
/** Post-parse shape of {@link DependencyGraphNode} — defaults applied, transforms run (ADR-0122). */
export type DependencyGraphNodeParsed = z.infer<typeof DependencyGraphNodeSchema>;

/**
 * Dependency Graph
 */
export const DependencyGraphSchema = lazySchema(() => z.object({
  /**
   * Root package
   */
  root: z.object({
    id: z.string().describe('Identifier of the root package'),
    version: z.string().describe('Version of the root package'),
  }).describe('Root package of the dependency graph'),
  
  /**
   * All nodes in the graph
   */
  nodes: z.array(DependencyGraphNodeSchema).describe('All resolved package nodes in the dependency graph'),
  
  /**
   * Edges (dependency relationships)
   */
  edges: z.array(z.object({
    from: z.string().describe('Package ID'),
    to: z.string().describe('Package ID'),
    constraint: z.string().describe('Version constraint'),
  })).describe('Directed edges representing dependency relationships'),
  
  /**
   * Resolution statistics
   */
  stats: z.object({
    totalDependencies: z.number().int().min(0).describe('Total number of resolved dependencies'),
    directDependencies: z.number().int().min(0).describe('Number of direct (top-level) dependencies'),
    maxDepth: z.number().int().min(0).describe('Maximum depth of the dependency tree'),
  }).describe('Summary statistics for the dependency graph'),
}).describe('Complete dependency graph for a package and its transitive dependencies'));

export type DependencyGraph = z.infer<typeof DependencyGraphSchema>;
/** Post-parse shape of {@link DependencyGraph} — defaults applied, transforms run (ADR-0122). */
export type DependencyGraphParsed = z.infer<typeof DependencyGraphSchema>;

/**
 * Dependency Conflict
 * 
 * Hub-level dependency conflict detected during plugin resolution.
 * Focuses on package version conflicts across the marketplace/registry.
 * 
 * @see kernel/plugin-versioning.zod.ts DependencyConflictSchema for kernel-level plugin conflicts
 *      which models plugin-to-plugin conflicts with richer resolution strategies.
 */
export const PackageDependencyConflictSchema = lazySchema(() => z.object({
  /**
   * Package with conflict
   */
  package: z.string().describe('Name of the package with conflicting version requirements'),
  
  /**
   * Conflicting versions
   */
  conflicts: z.array(z.object({
    version: z.string().describe('Conflicting version of the package'),
    requestedBy: z.array(z.string()).describe('Packages that require this version'),
    constraint: z.string().describe('Semver constraint that produced this version requirement'),
  })).describe('List of conflicting version requirements'),
  
  /**
   * Suggested resolution
   */
  resolution: z.object({
    strategy: z.enum(['pick-highest', 'pick-lowest', 'manual']).describe('Strategy used to resolve the conflict'),
    version: z.string().optional().describe('Resolved version selected by the strategy'),
    reason: z.string().optional().describe('Explanation of why this resolution was chosen'),
  }).optional().describe('Suggested resolution for the conflict'),
  
  /**
   * Severity
   */
  severity: z.enum(['error', 'warning', 'info']).describe('Severity level of the dependency conflict'),
}).describe('A detected conflict between dependency version requirements'));

export type PackageDependencyConflict = z.infer<typeof PackageDependencyConflictSchema>;

/**
 * Dependency Resolution Result
 */
export const PackageDependencyResolutionResultSchema = lazySchema(() => z.object({
  /**
   * Resolution status
   */
  status: z.enum(['success', 'conflict', 'error']).describe('Overall status of the dependency resolution'),
  
  /**
   * Resolved dependency graph
   */
  graph: DependencyGraphSchema.optional().describe('Resolved dependency graph if resolution succeeded'),
  
  /**
   * Conflicts detected
   */
  conflicts: z.array(PackageDependencyConflictSchema).default([]).describe('List of dependency conflicts detected during resolution'),
  
  /**
   * Errors encountered
   */
  errors: z.array(z.object({
    package: z.string().describe('Name of the package that caused the error'),
    error: z.string().describe('Error message describing what went wrong'),
  })).default([]).describe('Errors encountered during dependency resolution'),
  
  /**
   * Installation order (topological sort)
   */
  installOrder: z.array(z.string()).default([]).describe('Topologically sorted list of package IDs for installation'),
  
  /**
   * Resolution time (ms)
   */
  resolvedIn: z.number().int().min(0).optional().describe('Time taken to resolve dependencies in milliseconds'),
}).describe('Result of a dependency resolution process'));

export type PackageDependencyResolutionResult = z.infer<typeof PackageDependencyResolutionResultSchema>;
/** Post-parse shape of {@link PackageDependencyResolutionResult} — defaults applied, transforms run (ADR-0122). */
export type PackageDependencyResolutionResultParsed = z.infer<typeof PackageDependencyResolutionResultSchema>;

// ============================================================================
// Supply Chain Security
// ============================================================================

/**
 * SBOM (Software Bill of Materials) Entry
 */
export const SBOMEntrySchema = lazySchema(() => z.object({
  /**
   * Component name
   */
  name: z.string().describe('Name of the software component'),
  
  /**
   * Component version
   */
  version: z.string().describe('Version of the software component'),
  
  /**
   * Package URL (purl)
   */
  purl: z.string().optional().describe('Package URL identifier'),
  
  /**
   * License
   */
  license: z.string().optional().describe('SPDX license identifier of the component'),
  
  /**
   * Hashes
   */
  hashes: z.object({
    sha256: z.string().optional().describe('SHA-256 hash of the component artifact'),
    sha512: z.string().optional().describe('SHA-512 hash of the component artifact'),
  }).optional().describe('Cryptographic hashes for integrity verification'),
  
  /**
   * Supplier
   */
  supplier: z.object({
    name: z.string().describe('Name of the component supplier'),
    url: z.string().url().optional().describe('URL of the component supplier'),
  }).optional().describe('Supplier information for the component'),
  
  /**
   * External references
   */
  externalRefs: z.array(z.object({
    type: z.enum(['website', 'repository', 'documentation', 'issue-tracker']).describe('Type of external reference'),
    url: z.string().url().describe('URL of the external reference'),
  })).default([]).describe('External references related to the component'),
}).describe('A single entry in a Software Bill of Materials'));

export type SBOMEntry = z.infer<typeof SBOMEntrySchema>;
/** Post-parse shape of {@link SBOMEntry} — defaults applied, transforms run (ADR-0122). */
export type SBOMEntryParsed = z.infer<typeof SBOMEntrySchema>;

/**
 * Software Bill of Materials (SBOM)
 */
export const SBOMSchema = lazySchema(() => z.object({
  /**
   * SBOM format
   */
  format: z.enum(['spdx', 'cyclonedx']).default('cyclonedx').describe('SBOM standard format used'),
  
  /**
   * SBOM version
   */
  version: z.string().describe('Version of the SBOM specification'),
  
  /**
   * Plugin metadata
   */
  plugin: z.object({
    id: z.string().describe('Plugin identifier'),
    version: z.string().describe('Plugin version'),
    name: z.string().describe('Human-readable plugin name'),
  }).describe('Metadata about the plugin this SBOM describes'),
  
  /**
   * Components (dependencies)
   */
  components: z.array(SBOMEntrySchema).describe('List of software components included in the plugin'),
  
  /**
   * Generation timestamp
   */
  generatedAt: z.string().datetime().describe('ISO 8601 timestamp when the SBOM was generated'),
  
  /**
   * Generator tool
   */
  generator: z.object({
    name: z.string().describe('Name of the SBOM generator tool'),
    version: z.string().describe('Version of the SBOM generator tool'),
  }).optional().describe('Tool used to generate this SBOM'),
}).describe('Software Bill of Materials for a plugin'));

export type SBOM = z.infer<typeof SBOMSchema>;
/** Post-parse shape of {@link SBOM} — defaults applied, transforms run (ADR-0122). */
export type SBOMParsed = z.infer<typeof SBOMSchema>;

/**
 * Plugin Provenance
 * Verifiable chain of custody for plugin artifacts
 */
export const PluginProvenanceSchema = lazySchema(() => z.object({
  /**
   * Plugin identifier
   */
  pluginId: z.string().describe('Unique identifier of the plugin'),
  
  /**
   * Plugin version
   */
  version: z.string().describe('Version of the plugin artifact'),
  
  /**
   * Build information
   */
  build: z.object({
    /**
     * Build timestamp
     */
    timestamp: z.string().datetime().describe('ISO 8601 timestamp when the build was produced'),
    
    /**
     * Build environment
     */
    environment: z.object({
      os: z.string().describe('Operating system used for the build'),
      arch: z.string().describe('CPU architecture used for the build'),
      nodeVersion: z.string().describe('Node.js version used for the build'),
    }).optional().describe('Environment details where the build was executed'),
    
    /**
     * Source repository
     */
    source: z.object({
      repository: z.string().url().describe('URL of the source repository'),
      commit: z.string().regex(/^[a-f0-9]{40}$/).describe('Full SHA-1 commit hash of the source'),
      branch: z.string().optional().describe('Branch name the build was produced from'),
      tag: z.string().optional().describe('Git tag associated with the build'),
    }).optional().describe('Source repository information for the build'),
    
    /**
     * Builder identity
     */
    builder: z.object({
      name: z.string().describe('Name of the person or system that produced the build'),
      email: z.string().email().optional().describe('Email address of the builder'),
    }).optional().describe('Identity of the builder who produced the artifact'),
  }).describe('Build provenance information'),
  
  /**
   * Artifact hashes
   */
  artifacts: z.array(z.object({
    filename: z.string().describe('Name of the artifact file'),
    sha256: z.string().describe('SHA-256 hash of the artifact'),
    size: z.number().int().positive().describe('Size of the artifact in bytes'),
  })).describe('List of build artifacts with integrity hashes'),
  
  /**
   * Signatures
   */
  signatures: z.array(z.object({
    algorithm: z.enum(['rsa', 'ecdsa', 'ed25519']).describe('Cryptographic algorithm used for signing'),
    publicKey: z.string().describe('Public key used to verify the signature'),
    signature: z.string().describe('Digital signature value'),
    signedBy: z.string().describe('Identity of the signer'),
    timestamp: z.string().datetime().describe('ISO 8601 timestamp when the signature was created'),
  })).default([]).describe('Cryptographic signatures for the plugin artifact'),
  
  /**
   * Attestations
   */
  attestations: z.array(z.object({
    type: z.enum(['code-review', 'security-scan', 'test-results', 'ci-build']).describe('Type of attestation'),
    status: z.enum(['passed', 'failed']).describe('Result status of the attestation'),
    url: z.string().url().optional().describe('URL with details about the attestation'),
    timestamp: z.string().datetime().describe('ISO 8601 timestamp when the attestation was issued'),
  })).default([]).describe('Verification attestations for the plugin'),
}).describe('Verifiable provenance and chain of custody for a plugin artifact'));

export type PluginProvenance = z.infer<typeof PluginProvenanceSchema>;
/** Post-parse shape of {@link PluginProvenance} — defaults applied, transforms run (ADR-0122). */
export type PluginProvenanceParsed = z.infer<typeof PluginProvenanceSchema>;

// ============================================================================
// Trust & Verification
// ============================================================================

/**
 * Plugin Trust Score
 */
export const PluginTrustScoreSchema = lazySchema(() => z.object({
  /**
   * Plugin identifier
   */
  pluginId: z.string().describe('Unique identifier of the plugin'),
  
  /**
   * Overall trust score (0-100)
   */
  score: z.number().min(0).max(100).describe('Overall trust score from 0 to 100'),
  
  /**
   * Score components
   */
  components: z.object({
    /**
     * Vendor reputation (0-100)
     */
    vendorReputation: z.number().min(0).max(100).describe('Vendor reputation score from 0 to 100'),
    
    /**
     * Security scan results (0-100)
     */
    securityScore: z.number().min(0).max(100).describe('Security scan results score from 0 to 100'),
    
    /**
     * Code quality (0-100)
     */
    codeQuality: z.number().min(0).max(100).describe('Code quality score from 0 to 100'),
    
    /**
     * Community engagement (0-100)
     */
    communityScore: z.number().min(0).max(100).describe('Community engagement score from 0 to 100'),
    
    /**
     * Update frequency (0-100)
     */
    maintenanceScore: z.number().min(0).max(100).describe('Maintenance and update frequency score from 0 to 100'),
  }).describe('Individual score components contributing to the overall trust score'),
  
  /**
   * Trust level
   */
  level: z.enum(['verified', 'trusted', 'neutral', 'untrusted', 'blocked']).describe('Computed trust level based on the overall score'),
  
  /**
   * Verification badges
   */
  badges: z.array(z.enum([
    'official',           // Official ObjectStack plugin
    'verified-vendor',    // Verified vendor
    'security-scanned',   // Passed security scan
    'code-signed',        // Digitally signed
    'open-source',        // Open source
    'popular',            // High downloads
  ])).default([]).describe('Verification badges earned by the plugin'),
  
  /**
   * Last updated
   */
  updatedAt: z.string().datetime().describe('ISO 8601 timestamp when the trust score was last updated'),
}).describe('Trust score and verification status for a plugin'));

export type PluginTrustScore = z.infer<typeof PluginTrustScoreSchema>;
/** Post-parse shape of {@link PluginTrustScore} — defaults applied, transforms run (ADR-0122). */
export type PluginTrustScoreParsed = z.infer<typeof PluginTrustScoreSchema>;

// ============================================================================
// Export All
// ============================================================================

export const PluginSecurityProtocol = {
  VulnerabilitySeverity,
  SecurityVulnerability: SecurityVulnerabilitySchema,
  SecurityScanResult: SecurityScanResultSchema,
  SecurityPolicy: SecurityPolicySchema,
  ResolvedPackageDependency: ResolvedPackageDependencySchema,
  DependencyGraphNode: DependencyGraphNodeSchema,
  DependencyGraph: DependencyGraphSchema,
  DependencyConflict: PackageDependencyConflictSchema,
  DependencyResolutionResult: PackageDependencyResolutionResultSchema,
  SBOMEntry: SBOMEntrySchema,
  SBOM: SBOMSchema,
  PluginProvenance: PluginProvenanceSchema,
  PluginTrustScore: PluginTrustScoreSchema,
} as const;
