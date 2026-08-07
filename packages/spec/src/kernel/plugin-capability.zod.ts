// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Plugin Capability Protocol
 * 
 * Defines the standard way plugins declare their capabilities, implementations,
 * and conformance levels to ensure interoperability across vendors.
 * 
 * Based on the Protocol-Oriented Architecture pattern similar to:
 * - Kubernetes CRDs (Custom Resource Definitions)
 * - OSGi Service Registry
 * - Eclipse Extension Points
 */

/**
 * Capability Conformance Level
 * Indicates how completely a plugin implements a given protocol.
 */
import { lazySchema } from '../shared/lazy-schema';
export const CapabilityConformanceLevelSchema = lazySchema(() => z.enum([
  'full',        // Complete implementation of all protocol features
  'partial',     // Subset implementation with specific features listed
  'experimental', // Unstable/preview implementation
  'deprecated',  // Still supported but scheduled for removal
]).describe('Level of protocol conformance'));

/**
 * Protocol Version Schema
 * Uses semantic versioning to track protocol evolution.
 */
export const ProtocolVersionSchema = lazySchema(() => z.object({
  major: z.number().int().min(0),
  minor: z.number().int().min(0),
  patch: z.number().int().min(0),
}).describe('Semantic version of the protocol'));

/**
 * Protocol Reference
 * Uniquely identifies a protocol/interface that a plugin can implement.
 * 
 * Examples:
 * - com.objectstack.protocol.storage.v1
 * - com.objectstack.protocol.auth.oauth2.v2
 * - com.acme.protocol.payment.stripe.v1
 */
export const ProtocolReferenceSchema = lazySchema(() => z.object({
  /**
   * Protocol identifier using reverse domain notation.
   * Format: {domain}.protocol.{category}.{name}[.{subcategory}].v{major}
   */
  id: z.string()
    .regex(/^([a-z][a-z0-9]*\.)+protocol\.[a-z][a-z0-9._]*\.v\d+$/)
    .describe('Unique protocol identifier (e.g., com.objectstack.protocol.storage.v1)'),
  
  /**
   * Human-readable protocol name
   */
  label: z.string(),
  
  /**
   * Protocol version
   */
  version: ProtocolVersionSchema,
  
  /**
   * Detailed protocol specification URL or file reference
   */
  specification: z.string().optional().describe('URL or path to protocol specification'),
  
  /**
   * Brief description of what this protocol defines
   */
  description: z.string().optional(),
}));

/**
 * Protocol Feature
 * Represents a specific capability within a protocol.
 */
export const ProtocolFeatureSchema = lazySchema(() => z.object({
  name: z.string().describe('Feature identifier within the protocol'),
  enabled: z.boolean().default(true),
  description: z.string().optional(),
  sinceVersion: z.string().optional().describe('Version when this feature was added'),
  deprecatedSince: z.string().optional().describe('Version when deprecated'),
}));

/**
 * Plugin Capability Declaration
 * Documents what protocols a plugin implements and to what extent.
 */
export const PluginCapabilitySchema = lazySchema(() => z.object({
  /**
   * The protocol being implemented
   */
  protocol: ProtocolReferenceSchema,
  
  /**
   * Conformance level
   */
  conformance: CapabilityConformanceLevelSchema.default('full'),
  
  /**
   * Specific features implemented (required if conformance is 'partial')
   */
  implementedFeatures: z.array(z.string()).optional().describe('List of implemented feature names'),
  
  /**
   * Optional feature flags indicating advanced capabilities
   */
  features: z.array(ProtocolFeatureSchema).optional(),
  
  /**
   * Custom metadata for vendor-specific information
   */
  metadata: z.record(z.string(), z.unknown()).optional(),
  
  /**
   * Testing/Certification status
   */
  certified: z.boolean().default(false).describe('Has passed official conformance tests'),
  certificationDate: z.string().datetime().optional(),
}));

/**
 * Plugin Interface Declaration
 * Defines the contract for services this plugin provides to other plugins.
 */
export const PluginInterfaceSchema = lazySchema(() => z.object({
  /**
   * Unique interface identifier
   * Format: {plugin-id}.interface.{name}
   */
  id: z.string()
    .regex(/^([a-z][a-z0-9]*\.)+interface\.[a-z][a-z0-9._]+$/)
    .describe('Unique interface identifier'),
  
  /**
   * Interface name
   */
  name: z.string(),
  
  /**
   * Description of what this interface provides
   */
  description: z.string().optional(),
  
  /**
   * Interface version
   */
  version: ProtocolVersionSchema,
  
  /**
   * Methods exposed by this interface
   */
  methods: z.array(z.object({
    name: z.string().describe('Method name'),
    description: z.string().optional(),
    parameters: z.array(z.object({
      name: z.string(),
      type: z.string().describe('Type notation (e.g., string, number, User)'),
      required: z.boolean().default(true),
      description: z.string().optional(),
    })).optional(),
    returnType: z.string().optional().describe('Return value type'),
    async: z.boolean().default(false).describe('Whether method returns a Promise'),
  })),
  
  /**
   * Events emitted by this interface
   */
  events: z.array(z.object({
    name: z.string().describe('Event name'),
    description: z.string().optional(),
    payload: z.string().optional().describe('Event payload type'),
  })).optional(),
  
  /**
   * Stability level
   */
  stability: z.enum(['stable', 'beta', 'alpha', 'experimental']).default('stable'),
}));

/**
 * Plugin Dependency Declaration
 * Specifies what other plugins or capabilities this plugin requires.
 */
export const PluginDependencySchema = lazySchema(() => z.object({
  /**
   * Plugin ID using reverse domain notation
   */
  pluginId: z.string()
    .regex(/^([a-z][a-z0-9]*\.)+[a-z][a-z0-9-]+$/)
    .describe('Required plugin identifier'),
  
  /**
   * Version constraint (supports semver ranges)
   * Examples: "1.0.0", "^1.2.3", ">=2.0.0 <3.0.0"
   */
  version: z.string().describe('Semantic version constraint'),
  
  /**
   * Whether this dependency is optional
   */
  optional: z.boolean().default(false),
  
  /**
   * Reason for the dependency
   */
  reason: z.string().optional(),
  
  /**
   * Minimum required capabilities from the dependency
   */
  requiredCapabilities: z.array(z.string()).optional().describe('Protocol IDs the dependency must support'),
}));

/**
 * Extension Point Declaration
 * Defines hooks where other plugins can extend this plugin's functionality.
 */
export const ExtensionPointSchema = lazySchema(() => z.object({
  /**
   * Extension point identifier
   */
  id: z.string()
    .regex(/^([a-z][a-z0-9]*\.)+extension\.[a-z][a-z0-9._]+$/)
    .describe('Unique extension point identifier'),
  
  /**
   * Extension point name
   */
  name: z.string(),
  
  /**
   * Description
   */
  description: z.string().optional(),
  
  /**
   * Type of extension point
   */
  type: z.enum([
    'action',          // Plugins can register executable actions
    'hook',            // Plugins can listen to lifecycle events
    'widget',          // Plugins can contribute UI widgets
    'provider',        // Plugins can provide data/services
    'transformer',     // Plugins can transform data
    'validator',       // Plugins can validate data
    'decorator',       // Plugins can enhance/wrap functionality
  ]),
  
  /**
   * Expected interface contract for extensions
   */
  contract: z.object({
    input: z.string().optional().describe('Input type/schema'),
    output: z.string().optional().describe('Output type/schema'),
    signature: z.string().optional().describe('Function signature if applicable'),
  }).optional(),
  
  /**
   * Cardinality
   */
  cardinality: z.enum(['single', 'multiple']).default('multiple')
    .describe('Whether multiple extensions can register to this point'),
}));

/**
 * Complete Plugin Capability Manifest
 * This is included in the main plugin manifest to declare all capabilities.
 */
export const PluginCapabilityManifestSchema = lazySchema(() => z.object({
  /**
   * Protocols this plugin implements
   */
  implements: z.array(PluginCapabilitySchema).optional()
    .describe('List of protocols this plugin conforms to'),
  
  /**
   * Interfaces this plugin exposes to other plugins
   */
  provides: z.array(PluginInterfaceSchema).optional()
    .describe('Services/APIs this plugin offers to others'),
  
  /**
   * Dependencies on other plugins
   */
  requires: z.array(PluginDependencySchema).optional()
    .describe('Required plugins and their capabilities'),
  
  /**
   * Extension points this plugin defines
   */
  extensionPoints: z.array(ExtensionPointSchema).optional()
    .describe('Points where other plugins can extend this plugin'),
  
  /**
   * Extensions this plugin contributes to other plugins
   */
  extensions: z.array(z.object({
    targetPluginId: z.string().describe('Plugin ID being extended'),
    extensionPointId: z.string().describe('Extension point identifier'),
    implementation: z.string().describe('Path to implementation module'),
    priority: z.number().int().default(100).describe('Registration priority (lower = higher priority)'),
  })).optional().describe('Extensions contributed to other plugins'),
}));

// Export types
export type CapabilityConformanceLevel = z.input<typeof CapabilityConformanceLevelSchema>;
export type ProtocolVersion = z.input<typeof ProtocolVersionSchema>;
export type ProtocolReference = z.input<typeof ProtocolReferenceSchema>;
export type ProtocolFeature = z.input<typeof ProtocolFeatureSchema>;
/** Post-parse shape of {@link ProtocolFeature} — defaults applied, transforms run (ADR-0122). */
export type ProtocolFeatureParsed = z.infer<typeof ProtocolFeatureSchema>;
export type PluginCapability = z.input<typeof PluginCapabilitySchema>;
/** Post-parse shape of {@link PluginCapability} — defaults applied, transforms run (ADR-0122). */
export type PluginCapabilityParsed = z.infer<typeof PluginCapabilitySchema>;
export type PluginInterface = z.input<typeof PluginInterfaceSchema>;
/** Post-parse shape of {@link PluginInterface} — defaults applied, transforms run (ADR-0122). */
export type PluginInterfaceParsed = z.infer<typeof PluginInterfaceSchema>;
export type PluginDependency = z.input<typeof PluginDependencySchema>;
/** Post-parse shape of {@link PluginDependency} — defaults applied, transforms run (ADR-0122). */
export type PluginDependencyParsed = z.infer<typeof PluginDependencySchema>;
export type ExtensionPoint = z.input<typeof ExtensionPointSchema>;
/** Post-parse shape of {@link ExtensionPoint} — defaults applied, transforms run (ADR-0122). */
export type ExtensionPointParsed = z.infer<typeof ExtensionPointSchema>;
export type PluginCapabilityManifest = z.input<typeof PluginCapabilityManifestSchema>;
/** Post-parse shape of {@link PluginCapabilityManifest} — defaults applied, transforms run (ADR-0122). */
export type PluginCapabilityManifestParsed = z.infer<typeof PluginCapabilityManifestSchema>;
