// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Plugin, PluginContext } from './types.js';
import type { Logger } from '@objectstack/spec/contracts';
import { PluginSchema } from '@objectstack/spec/kernel';
import { parseSignature } from './security/plugin-artifact-signature.js';
import { serviceNotRegisteredError } from './service-not-registered.js';

/**
 * The code carried by a refusal raised because the plugin object does not
 * satisfy `PluginSchema` — the protocol's own declaration of what a plugin
 * object may be (`@objectstack/spec`, `kernel/plugin.zod.ts`).
 *
 * ⚠️ Spelled the ADR-0112 way and deliberately NOT wire vocabulary, exactly
 * like {@link SERVICE_NOT_REGISTERED_CODE} one module over: this refusal is
 * raised while the kernel is still assembling itself, before any HTTP boundary
 * exists, and `dispatcher-error-vocabulary.ts` classifies it `door: 'none'` /
 * `boot-refusal` for that reason. It is stamped on `err.code` for an in-process
 * catcher AND repeated at the head of the message, because the message is what
 * survives: `ObjectKernel.use()` re-wraps a failed load into a fresh `Error`
 * carrying only `result.error?.message`, so a code that lived only on the
 * property would not reach the caller that actually sees the boot fail.
 */
const PLUGIN_CONTRACT_VIOLATION_CODE = 'PLUGIN_CONTRACT_VIOLATION';

/**
 * Service Lifecycle Types
 * Defines how services are instantiated and managed
 */
export enum ServiceLifecycle {
    /** Single instance shared across all requests */
    SINGLETON = 'singleton',
    /** New instance created for each request */
    TRANSIENT = 'transient',
    /** New instance per scope (e.g., per HTTP request) */
    SCOPED = 'scoped',
}

/**
 * Service Factory
 * Function that creates a service instance
 */
export type ServiceFactory<T = any> = (ctx: PluginContext, scopeId?: string) => T | Promise<T>;

/**
 * Service Registration Options
 */
export interface ServiceRegistration {
    name: string;
    factory: ServiceFactory;
    lifecycle: ServiceLifecycle;
    dependencies?: string[];
}

/**
 * Plugin Metadata with Enhanced Features
 */
export interface PluginMetadata extends Plugin {
    /** Semantic version (e.g., "1.0.0") */
    version: string;

    // `configSchema` was retired on 2026-08-27 (ADR-0049 enforce-or-remove;
    // recorded in ADR-0025 §3.7): the loader's only call passed no config and
    // no caller could — plugin factories close over their config, so the
    // kernel never receives it. Plugins parse their own config at their own
    // seam instead (the `packages/rest` pattern). Re-declaring a kernel-owned
    // config-validation surface is a fresh decision for the day the ADR-0025
    // distribution layer lands.

    /** Plugin signature for security verification */
    signature?: string;
    
    /** Plugin health check function */
    healthCheck?(): Promise<PluginHealthStatus>;
    
    /** Startup timeout in milliseconds (default: 30000) */
    startupTimeout?: number;

    // `hotReloadable` was retired on 2026-08-27 (#12587, same ADR-0049 batch):
    // declared and documented with zero reads — `HotReloadManager.reloadPlugin`
    // gates only on its own registered reload configs, so `hotReloadable:
    // false` was hot-reloaded identically to `true`. Reload participation is
    // governed solely by `HotReloadManager.registerReloadConfig`.
}

/**
 * Plugin Health Status
 */
export interface PluginHealthStatus {
    healthy: boolean;
    message?: string;
    details?: Record<string, any>;
    lastCheck?: Date;
}

/**
 * Plugin Load Result
 */
export interface PluginLoadResult {
    success: boolean;
    plugin?: PluginMetadata;
    error?: Error;
    loadTime?: number;
}

/**
 * Plugin Startup Result
 */
export interface PluginStartupResult {
    success: boolean;
    pluginName: string;
    startTime?: number;
    error?: Error;
    timedOut?: boolean;
}

/**
 * Version Compatibility Result
 */
export interface VersionCompatibility {
    compatible: boolean;
    pluginVersion: string;
    requiredVersion?: string;
    message?: string;
}

/**
 * Enhanced Plugin Loader
 * Provides advanced plugin loading capabilities with validation, security, and lifecycle management
 */
export class PluginLoader {
    private logger: Logger;
    private context?: PluginContext;
    private loadedPlugins: Map<string, PluginMetadata> = new Map();
    private serviceFactories: Map<string, ServiceRegistration> = new Map();
    private serviceInstances: Map<string, any> = new Map();
    private scopedServices: Map<string, Map<string, any>> = new Map();
    private creating: Set<string> = new Set();

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * Set the plugin context for service factories
     */
    setContext(context: PluginContext): void {
        this.context = context;
    }

    /**
     * Get a synchronous service instance if it exists (Sync Helper)
     */
    getServiceInstance<T>(name: string): T | undefined {
        return this.serviceInstances.get(name) as T;
    }

    /**
     * Load a plugin asynchronously with validation
     */
    async loadPlugin(plugin: Plugin): Promise<PluginLoadResult> {
        const startTime = Date.now();
        
        try {
            this.logger.info(`Loading plugin: ${plugin.name}`);
            
            // Convert to PluginMetadata
            const metadata = this.toPluginMetadata(plugin);
            
            // Validate plugin structure
            this.validatePluginStructure(metadata);
            
            // Validate against the DECLARED contract (#16049)
            this.validatePluginContract(metadata);
            
            // Check version compatibility
            const versionCheck = this.checkVersionCompatibility(metadata);
            if (!versionCheck.compatible) {
                throw new Error(`Version incompatible: ${versionCheck.message}`);
            }
            
            // Verify signature if provided
            if (metadata.signature) {
                await this.verifyPluginSignature(metadata);
            }
            
            // Store loaded plugin
            this.loadedPlugins.set(metadata.name, metadata);
            
            const loadTime = Date.now() - startTime;
            this.logger.info(`Plugin loaded: ${plugin.name} (${loadTime}ms)`);
            
            return {
                success: true,
                plugin: metadata,
                loadTime,
            };
        } catch (error) {
            this.logger.error(`Failed to load plugin: ${plugin.name}`, error as Error);
            return {
                success: false,
                error: error as Error,
                loadTime: Date.now() - startTime,
            };
        }
    }

    /**
     * Register a service with factory function
     */
    registerServiceFactory(registration: ServiceRegistration): void {
        if (this.serviceFactories.has(registration.name)) {
            throw new Error(`Service factory '${registration.name}' already registered`);
        }
        
        this.serviceFactories.set(registration.name, registration);
        this.logger.debug(`Service factory registered: ${registration.name} (${registration.lifecycle})`);
    }

    /**
     * Get or create a service instance based on lifecycle type
     */
    async getService<T>(name: string, scopeId?: string): Promise<T> {
        const registration = this.serviceFactories.get(name);
        
        if (!registration) {
            // Fall back to static service instances
            const instance = this.serviceInstances.get(name);
            if (!instance) {
                // [#13905] The ONE rejection on this method that means "nothing
                // was ever registered under this name". Branded so a caller
                // holding only the rejection can tell it from a service that IS
                // registered and failed to construct (a factory that threw, a
                // missing scope id, an unset context, a circular dependency) —
                // which all reject from below, unbranded, and so stay loud.
                // The message is unchanged; the discriminator rides beside it.
                // ⛔ Not message text: see `service-not-registered.ts` for why
                // this repo does not classify a resolution fault by matching on
                // it.
                throw serviceNotRegisteredError(name);
            }
            return instance as T;
        }
        
        switch (registration.lifecycle) {
            case ServiceLifecycle.SINGLETON:
                return await this.getSingletonService<T>(registration);
                
            case ServiceLifecycle.TRANSIENT:
                return await this.createTransientService<T>(registration);
                
            case ServiceLifecycle.SCOPED:
                if (!scopeId) {
                    throw new Error(`Scope ID required for scoped service '${name}'`);
                }
                return await this.getScopedService<T>(registration, scopeId);
                
            default:
                throw new Error(`Unknown service lifecycle: ${registration.lifecycle}`);
        }
    }

    /**
     * Register a static service instance (legacy support)
     */
    registerService(name: string, service: any): void {
        if (this.serviceInstances.has(name)) {
            throw new Error(`Service '${name}' already registered`);
        }
        this.serviceInstances.set(name, service);
    }

    /**
     * Replace an existing service instance.
     * Used by optimization plugins to swap kernel internals.
     * @throws Error if service does not exist
     */
    replaceService(name: string, service: any): void {
        if (!this.hasService(name)) {
            throw new Error(`Service '${name}' not found`);
        }
        this.serviceInstances.set(name, service);
    }

    /**
     * Check if a service is registered (either as instance or factory)
     */
    hasService(name: string): boolean {
        return this.serviceInstances.has(name) || this.serviceFactories.has(name);
    }

    /**
     * Detect circular dependencies in service factories
     * Note: This only detects cycles in service dependencies, not plugin dependencies.
     * Plugin dependency cycles are detected in the kernel's resolveDependencies method.
     */
    detectCircularDependencies(): string[] {
        const cycles: string[] = [];
        const visited = new Set<string>();
        const visiting = new Set<string>();
        
        const visit = (serviceName: string, path: string[] = []) => {
            if (visiting.has(serviceName)) {
                const cycle = [...path, serviceName].join(' -> ');
                cycles.push(cycle);
                return;
            }
            
            if (visited.has(serviceName)) {
                return;
            }
            
            visiting.add(serviceName);
            
            const registration = this.serviceFactories.get(serviceName);
            if (registration?.dependencies) {
                for (const dep of registration.dependencies) {
                    visit(dep, [...path, serviceName]);
                }
            }
            
            visiting.delete(serviceName);
            visited.add(serviceName);
        };
        
        for (const serviceName of this.serviceFactories.keys()) {
            visit(serviceName);
        }
        
        return cycles;
    }

    /**
     * Check plugin health
     */
    async checkPluginHealth(pluginName: string): Promise<PluginHealthStatus> {
        const plugin = this.loadedPlugins.get(pluginName);
        
        if (!plugin) {
            return {
                healthy: false,
                message: 'Plugin not found',
                lastCheck: new Date(),
            };
        }
        
        if (!plugin.healthCheck) {
            return {
                healthy: true,
                message: 'No health check defined',
                lastCheck: new Date(),
            };
        }
        
        try {
            const status = await plugin.healthCheck();
            return {
                ...status,
                lastCheck: new Date(),
            };
        } catch (error) {
            return {
                healthy: false,
                message: `Health check failed: ${(error as Error).message}`,
                lastCheck: new Date(),
            };
        }
    }

    /**
     * Clear scoped services for a scope
     */
    clearScope(scopeId: string): void {
        this.scopedServices.delete(scopeId);
        this.logger.debug(`Cleared scope: ${scopeId}`);
    }

    /**
     * Get all loaded plugins
     */
    getLoadedPlugins(): Map<string, PluginMetadata> {
        return new Map(this.loadedPlugins);
    }

    // Private helper methods

    private toPluginMetadata(plugin: Plugin): PluginMetadata {
        // Fix: Do not use object spread {...plugin} as it destroys the prototype chain for Class-based plugins.
        // Instead, cast the original object and inject default values if missing.
        const metadata = plugin as PluginMetadata;
        
        if (!metadata.version) {
            metadata.version = '0.0.0';
        }
        
        return metadata;
    }

    private validatePluginStructure(plugin: PluginMetadata): void {
        if (!plugin.name) {
            throw new Error('Plugin name is required');
        }
        
        if (!plugin.init) {
            throw new Error('Plugin init function is required');
        }
        
        if (!this.isValidSemanticVersion(plugin.version)) {
            throw new Error(`Invalid semantic version: ${plugin.version}`);
        }
    }

    /**
     * Refuse a plugin object the DECLARED plugin contract refuses (#16049,
     * maintainer ruling 2026-09-06: "the protocol is the baseline; the runtime
     * aligns to it").
     *
     * ## What this closes
     *
     * `PluginSchema` had **zero runtime callers**. The boot path ran
     * {@link validatePluginStructure} — `name`, `init`, semver — and nothing
     * else, so every constraint the protocol declared beyond those three was a
     * declaration with nothing behind it: `defineStack` accepted a value that
     * `PluginSchema.safeParse` refused, and the plugin was stored verbatim and
     * mounted routes. A wrong `type` surfaced (if at all) at route mount; it
     * now surfaces here, named, at `kernel.use()`.
     *
     * ## What this refuses: the EIGHT declared keys, and `null` on any of them
     *
     * `PluginSchema` declares nine optional keys; the filter below drops
     * `version` (see below), so the accept-set narrowing this method
     * performs covers exactly these eight, each reported as `at '<key>'`:
     *
     * - `id` — a non-string, or the empty string (`z.string().min(1)`).
     * - `type` — outside the closed set `'standard'` + `CORE_PLUGIN_TYPES`.
     * - `staticPath` — a non-string.
     * - `slug` — a non-string, or not matching `/^[a-z0-9-_]+$/`.
     * - `default` — a non-boolean.
     * - `description` — a non-string.
     * - `author` — a non-string; an object such as `{ name }` is refused.
     * - `homepage` — a non-string, or a string that is not a URL.
     *
     * All eight are `.optional()`, which admits absence and `undefined` but
     * never an explicit `null` — so `null` on any of the eight is refused too.
     *
     * ⛔ ENUMERATE ALL EIGHT wherever this is restated. The changeset ships to
     * consumers as `CHANGELOG.md` and is what an upgrading author greps after
     * the refusal, so a shorter enumeration there does not merely omit keys —
     * it tells an author refused `at 'author'` that their key is not enforced.
     * This comment, the changeset and the `PLUGIN_CONTRACT_VIOLATION` row in
     * `dispatcher-error-vocabulary.ts` are the three places that restate it.
     *
     * What this does NOT refuse, which is what bounds the narrowing: UNKNOWN
     * keys. `PluginSchema` is a plain `z.object` with no `.strict()` — the
     * strip posture — and the parse output is discarded here, so a plugin
     * carrying keys the schema never declares still loads, stored verbatim.
     *
     * ## ⛔ safeParse for VALIDATION ONLY — the parse output is discarded
     *
     * The returned object is a COPY, and {@link toPluginMetadata} exists
     * precisely because a copy "destroys the prototype chain for Class-based
     * plugins". Substituting the parse output for the plugin would break every
     * class-based plugin in the ecosystem while leaving this file's own tests
     * green, so the result is read for `success` and for nothing else.
     * `plugin-contract-enforcement.test.ts` pins a class-based plugin's
     * prototype surviving `use()`, which is what makes that a measurement
     * rather than a promise.
     *
     * ## Why `version` is excluded, and why that is not a weakening
     *
     * MEASURED on this tree, not assumed. `PluginSchema.version` is
     * `/^\d+\.\d+\.\d+$/`, which refuses the prerelease and build-metadata
     * forms SemVer 2.0.0 defines — while {@link isValidSemanticVersion}, the
     * check this loader has always run, implements the full grammar and accepts
     * them. Two declarations in this repository disagree about what a version
     * is, and `plugin-loader.test.ts` pins the wider one deliberately: "should
     * accept versions with pre-release tags" (`1.0.0-alpha.1`) and "should
     * accept versions with build metadata" (`1.0.0+20230101`). Two in-repo
     * class-based plugin fixtures ship `version = '0.0.0-fixture'` and boot
     * through the real kernel.
     *
     * So enforcing the schema's `version` here would not enforce the protocol —
     * it would RETIRE a pinned capability, silently, under a card that ruled on
     * `type`. Version is not among the eight keys enumerated above, and the
     * version check that already runs is the wider, correct one: a version-less
     * plugin loads, and so do `1.0.0-alpha.1` and `1.0.0+20230101`.
     * Reconciling the two spellings belongs in `packages/spec` beside
     * #16334; until then this exclusion is declared here rather than performed
     * by leaving the disagreement unmeasured.
     */
    private validatePluginContract(plugin: PluginMetadata): void {
        const result = PluginSchema.safeParse(plugin);
        if (result.success) {
            return;
        }

        const issues = result.error.issues.filter((issue) => issue.path[0] !== 'version');
        if (issues.length === 0) {
            return;
        }

        // The FIRST issue only: a boot refusal is read by a human reading one
        // log line, and the first violated key is the one to fix.
        const first = issues[0];
        const at = first.path.length > 0 ? first.path.join('.') : '(root)';
        const id = (plugin as { id?: unknown }).id;
        const named = typeof id === 'string' && id.length > 0
            ? `'${plugin.name}' (id: ${id})`
            : `'${plugin.name}'`;

        const error = new Error(
            `${PLUGIN_CONTRACT_VIOLATION_CODE}: plugin ${named} is refused by the declared plugin `
            + `contract at '${at}': ${first.message}`,
        ) as Error & { code?: string };
        error.code = PLUGIN_CONTRACT_VIOLATION_CODE;
        throw error;
    }

    private checkVersionCompatibility(plugin: PluginMetadata): VersionCompatibility {
        // Basic semantic version compatibility check
        // In a real implementation, this would check against kernel version
        const version = plugin.version;
        
        if (!this.isValidSemanticVersion(version)) {
            return {
                compatible: false,
                pluginVersion: version,
                message: 'Invalid semantic version format',
            };
        }
        
        return {
            compatible: true,
            pluginVersion: version,
        };
    }

    private isValidSemanticVersion(version: string): boolean {
        const semverRegex = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
        return semverRegex.test(version);
    }

    private async verifyPluginSignature(plugin: PluginMetadata): Promise<void> {
        if (!plugin.signature) {
            return;
        }
        
        // Cryptographic verification of a third-party plugin's PUBLISHER and
        // PLATFORM signatures is performed against the `.osplugin` artifact
        // bytes + version identity at materialize/install time, by
        // `verifyPluginArtifact` (security/plugin-artifact-signature.ts —
        // ADR-0025 §3.7). By the time a plugin reaches loadPlugin() it is an
        // in-memory module with no artifact bytes, so we cannot re-run the
        // artifact chains here; we only validate that any signature carried
        // on the metadata is well-formed (`ed25519:<keyId>:<base64url>`) and
        // surface its keyId, failing fast on a malformed value.
        const parsed = parseSignature(plugin.signature);
        if (!parsed) {
            throw new Error(
                `Plugin ${plugin.name} carries a malformed signature (expected ed25519:<keyId>:<base64url>)`,
            );
        }
        this.logger.debug(
            `Plugin ${plugin.name} signature well-formed (alg=${parsed.alg}, keyId=${parsed.keyId}); ` +
            `artifact verification occurs at materialize time`,
        );
    }

    private async getSingletonService<T>(registration: ServiceRegistration): Promise<T> {
        let instance = this.serviceInstances.get(registration.name);
        
        if (!instance) {
            // Create instance (would need context)
            instance = await this.createServiceInstance(registration);
            this.serviceInstances.set(registration.name, instance);
            this.logger.debug(`Singleton service created: ${registration.name}`);
        }
        
        return instance as T;
    }

    private async createTransientService<T>(registration: ServiceRegistration): Promise<T> {
        const instance = await this.createServiceInstance(registration);
        this.logger.debug(`Transient service created: ${registration.name}`);
        return instance as T;
    }

    private async getScopedService<T>(registration: ServiceRegistration, scopeId: string): Promise<T> {
        if (!this.scopedServices.has(scopeId)) {
            this.scopedServices.set(scopeId, new Map());
        }

        const scope = this.scopedServices.get(scopeId)!;
        let instance = scope.get(registration.name);

        if (!instance) {
            instance = await this.createServiceInstance(registration, scopeId);
            scope.set(registration.name, instance);
            this.logger.debug(`Scoped service created: ${registration.name} (scope: ${scopeId})`);
        }

        return instance as T;
    }

    private async createServiceInstance(registration: ServiceRegistration, scopeId?: string): Promise<any> {
        if (!this.context) {
            throw new Error(`[PluginLoader] Context not set - cannot create service '${registration.name}'`);
        }

        if (this.creating.has(registration.name)) {
            throw new Error(`Circular dependency detected: ${Array.from(this.creating).join(' -> ')} -> ${registration.name}`);
        }

        this.creating.add(registration.name);
        try {
            return await registration.factory(this.context, scopeId);
        } finally {
            this.creating.delete(registration.name);
        }
    }
}
