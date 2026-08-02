// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IPluginValidator - Plugin Validator Interface
 * 
 * Abstract interface for validating plugins before registration and startup.
 * Extracted from PluginLoader to follow Single Responsibility Principle.
 */

/**
 * Validation result for a plugin.
 *
 * [#4538] Re-exported from the zod source (`ValidationResultSchema`,
 * kernel/plugin-validator.zod.ts) instead of a hand-written twin — the two
 * declarations were field-for-field identical, and one declaration per name
 * is the rule (#4446). `ValidationError` / `ValidationWarning` element types
 * live there too.
 */
import type { ValidationResult } from '../kernel/plugin-validator.zod';
export type { ValidationResult } from '../kernel/plugin-validator.zod';

/**
 * Plugin metadata for validation
 */
export interface Plugin {
    /**
     * Unique plugin identifier
     */
    name: string;
    
    /**
     * Plugin version (semver)
     */
    version?: string;
    
    /**
     * Plugin dependencies (hard — a missing name fails the boot)
     */
    dependencies?: string[];

    /**
     * Soft dependencies — order-if-present (ADR-0116). Composed names are
     * hoisted ahead like `dependencies`; absent names are skipped.
     */
    optionalDependencies?: string[];

    /**
     * Services the plugin resolves synchronously during init(). The kernel
     * validates ordering against these before Phase 1 (ADR-0116).
     */
    requiresServices?: string[];

    /**
     * Services the plugin's init() unconditionally registers (ADR-0116).
     */
    providesServices?: string[];

    /**
     * Plugin initialization function
     */
    init?: (context: any) => void | Promise<void>;
    
    /**
     * Plugin startup function
     */
    start?: (context: any) => void | Promise<void>;
    
    /**
     * Plugin destruction function
     */
    destroy?: (context: any) => void | Promise<void>;
    
    /**
     * Plugin signature for verification (optional)
     */
    signature?: string;
    
    /**
     * Additional plugin metadata
     */
    [key: string]: any;
}

/**
 * IPluginValidator - Plugin validation interface
 */
export interface IPluginValidator {
    /**
     * Validate a plugin object structure
     * @param plugin - Plugin to validate
     * @returns Validation result
     */
    validate(plugin: unknown): ValidationResult;
    
    /**
     * Validate plugin version format (semver)
     * @param version - Version string to validate
     * @returns True if version is valid, false otherwise
     */
    validateVersion(version: string): boolean;
    
    /**
     * Validate plugin cryptographic signature (optional)
     * Used for plugin security verification
     * @param plugin - Plugin to validate
     * @returns Promise resolving to true if signature is valid
     */
    validateSignature?(plugin: Plugin): Promise<boolean>;
    
    /**
     * Validate plugin dependencies are satisfied
     * @param plugin - Plugin to validate
     * @param registry - Map of already registered plugins
     * @throws Error if dependencies are not satisfied
     */
    validateDependencies(plugin: Plugin, registry: Map<string, Plugin>): void;
    
    /**
     * Validate plugin has required lifecycle methods
     * @param plugin - Plugin to validate
     * @returns True if plugin has valid lifecycle methods
     */
    validateLifecycle?(plugin: Plugin): boolean;
}
