// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Logger } from '@objectstack/spec/contracts';
import type { PluginCapability, PluginPermissions as GrantedPermissions } from '@objectstack/spec/kernel';
import type { PluginContext } from '../types.js';

/**
 * Plugin Permissions
 * Defines what actions a plugin is allowed to perform
 */
export interface PluginPermissions {
  canAccessService(serviceName: string): boolean;
  canTriggerHook(hookName: string): boolean;
  canReadFile(path: string): boolean;
  canWriteFile(path: string): boolean;
  canNetworkRequest(url: string): boolean;
}

/**
 * Permission Check Result
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
  capability?: string;
}

/**
 * Plugin Permission Enforcer
 * 
 * Implements capability-based security model to enforce:
 * 1. Service access control - which services a plugin can use
 * 2. Hook restrictions - which hooks a plugin can trigger
 * 3. File system permissions - what files a plugin can read/write
 * 4. Network permissions - what URLs a plugin can access
 * 
 * Architecture:
 * - Uses capability declarations from plugin manifest
 * - Checks permissions before allowing operations
 * - Logs all permission denials for security audit
 * - Supports allowlist and denylist patterns
 * 
 * Security Model:
 * - Principle of least privilege - plugins get minimal permissions
 * - Explicit declaration - all capabilities must be declared
 * - Runtime enforcement - checks happen at operation time
 * - Audit trail - all denials are logged
 * 
 * Usage:
 * ```typescript
 * const enforcer = new PluginPermissionEnforcer(logger);
 * enforcer.registerPluginPermissions(pluginName, capabilities);
 * enforcer.enforceServiceAccess(pluginName, 'database');
 * ```
 */
export class PluginPermissionEnforcer {
  private logger: Logger;
  private permissionRegistry: Map<string, PluginPermissions> = new Map();
  private capabilityRegistry: Map<string, PluginCapability[]> = new Map();
  
  constructor(logger: Logger) {
    this.logger = logger;
  }
  
  /**
   * Register plugin capabilities and build permission set
   * 
   * @param pluginName - Plugin identifier
   * @param capabilities - Array of capability declarations
   */
  registerPluginPermissions(pluginName: string, capabilities: PluginCapability[]): void {
    this.capabilityRegistry.set(pluginName, capabilities);
    
    const permissions: PluginPermissions = {
      canAccessService: (service) => this.checkServiceAccess(capabilities, service),
      canTriggerHook: (hook) => this.checkHookAccess(capabilities, hook),
      canReadFile: (path) => this.checkFileRead(capabilities, path),
      canWriteFile: (path) => this.checkFileWrite(capabilities, path),
      canNetworkRequest: (url) => this.checkNetworkAccess(capabilities, url),
    };
    
    this.permissionRegistry.set(pluginName, permissions);
    
    this.logger.info(`Permissions registered for plugin: ${pluginName}`, {
      plugin: pluginName,
      capabilityCount: capabilities.length,
    });
  }
  
  /**
   * Register the install-time GRANTED permission set for a plugin
   * (ADR-0025 F4). This is the structured `{ services, hooks, network, fs }`
   * grant that the cloud control plane persists to
   * `sys_package_installation.granted_permissions` after the user consents
   * at install (ADR §3.5 step 2), and which reaches the runtime on the
   * environment artifact envelope. `AppPlugin.init()` calls this once per
   * consent-bearing package an artifact carries (#13457) — the only
   * production caller.
   *
   * ## ⚠️ REGISTERED, NOT ENFORCED — both halves, or the sentence lies
   *
   * REGISTERED at load: the consented set lands in this enforcer's registry
   * and {@link PluginPermissionEnforcer.getPluginPermissions} answers from it.
   *
   * NOT ENFORCED: nothing queries that registry. {@link enforceServiceAccess}
   * and {@link enforceHookTrigger} are reachable only through
   * {@link SecurePluginContext}, which has ZERO production construction
   * sites; {@link enforceFileRead}, {@link enforceFileWrite} and
   * {@link enforceNetworkRequest} are called by nothing at all —
   * `SecurePluginContext` included, so those three classes have no
   * enforcement surface even in principle. A registered grant therefore
   * records what was consented to and denies no operation.
   *
   * ⛔ Do not write that this class confines a plugin until a production
   * construction site exists. `granted-permissions-not-enforced.pin.test.ts`
   * fails on the claim AND on the measurement, so it goes red the day the
   * seam lands and tells that author the sentence is theirs to rewrite.
   * Building the per-plugin context is the ADR-0025 materialize seam
   * (#17147, Phase 1b of #11333).
   *
   * Prefer this over {@link registerPluginPermissions} for distributed
   * plugins: it registers what was granted, not what was declared.
   */
  registerGrantedPermissions(pluginName: string, granted: GrantedPermissions | null | undefined): void {
    this.permissionRegistry.set(pluginName, buildPermissionsFromGrants(granted));
    this.logger.info(`Granted permissions registered for plugin: ${pluginName}`, {
      plugin: pluginName,
      services: granted?.services?.length ?? 0,
      hooks: granted?.hooks?.length ?? 0,
      network: granted?.network?.length ?? 0,
      fs: granted?.fs?.length ?? 0,
    });
  }

  /**
   * Enforce service access permission
   *
   * @param pluginName - Plugin requesting access
   * @param serviceName - Service to access
   * @throws Error if permission denied
   */
  enforceServiceAccess(pluginName: string, serviceName: string): void {
    const result = this.checkPermission(pluginName, (perms) => perms.canAccessService(serviceName));
    
    if (!result.allowed) {
      const error = `Permission denied: Plugin ${pluginName} cannot access service ${serviceName}`;
      this.logger.warn(error, {
        plugin: pluginName,
        service: serviceName,
        reason: result.reason,
      });
      throw new Error(error);
    }
    
    this.logger.debug(`Service access granted: ${pluginName} -> ${serviceName}`);
  }
  
  /**
   * Enforce hook trigger permission
   * 
   * @param pluginName - Plugin requesting access
   * @param hookName - Hook to trigger
   * @throws Error if permission denied
   */
  enforceHookTrigger(pluginName: string, hookName: string): void {
    const result = this.checkPermission(pluginName, (perms) => perms.canTriggerHook(hookName));
    
    if (!result.allowed) {
      const error = `Permission denied: Plugin ${pluginName} cannot trigger hook ${hookName}`;
      this.logger.warn(error, {
        plugin: pluginName,
        hook: hookName,
        reason: result.reason,
      });
      throw new Error(error);
    }
    
    this.logger.debug(`Hook trigger granted: ${pluginName} -> ${hookName}`);
  }
  
  /**
   * Enforce file read permission
   * 
   * @param pluginName - Plugin requesting access
   * @param path - File path to read
   * @throws Error if permission denied
   */
  enforceFileRead(pluginName: string, path: string): void {
    const result = this.checkPermission(pluginName, (perms) => perms.canReadFile(path));
    
    if (!result.allowed) {
      const error = `Permission denied: Plugin ${pluginName} cannot read file ${path}`;
      this.logger.warn(error, {
        plugin: pluginName,
        path,
        reason: result.reason,
      });
      throw new Error(error);
    }
    
    this.logger.debug(`File read granted: ${pluginName} -> ${path}`);
  }
  
  /**
   * Enforce file write permission
   * 
   * @param pluginName - Plugin requesting access
   * @param path - File path to write
   * @throws Error if permission denied
   */
  enforceFileWrite(pluginName: string, path: string): void {
    const result = this.checkPermission(pluginName, (perms) => perms.canWriteFile(path));
    
    if (!result.allowed) {
      const error = `Permission denied: Plugin ${pluginName} cannot write file ${path}`;
      this.logger.warn(error, {
        plugin: pluginName,
        path,
        reason: result.reason,
      });
      throw new Error(error);
    }
    
    this.logger.debug(`File write granted: ${pluginName} -> ${path}`);
  }
  
  /**
   * Enforce network request permission
   * 
   * @param pluginName - Plugin requesting access
   * @param url - URL to access
   * @throws Error if permission denied
   */
  enforceNetworkRequest(pluginName: string, url: string): void {
    const result = this.checkPermission(pluginName, (perms) => perms.canNetworkRequest(url));
    
    if (!result.allowed) {
      const error = `Permission denied: Plugin ${pluginName} cannot access URL ${url}`;
      this.logger.warn(error, {
        plugin: pluginName,
        url,
        reason: result.reason,
      });
      throw new Error(error);
    }
    
    this.logger.debug(`Network request granted: ${pluginName} -> ${url}`);
  }
  
  /**
   * Get plugin capabilities
   * 
   * @param pluginName - Plugin identifier
   * @returns Array of capabilities or undefined
   */
  getPluginCapabilities(pluginName: string): PluginCapability[] | undefined {
    return this.capabilityRegistry.get(pluginName);
  }
  
  /**
   * Get plugin permissions
   * 
   * @param pluginName - Plugin identifier
   * @returns Permissions object or undefined
   */
  getPluginPermissions(pluginName: string): PluginPermissions | undefined {
    return this.permissionRegistry.get(pluginName);
  }
  
  /**
   * Revoke all permissions for a plugin
   * 
   * @param pluginName - Plugin identifier
   */
  revokePermissions(pluginName: string): void {
    this.permissionRegistry.delete(pluginName);
    this.capabilityRegistry.delete(pluginName);
    this.logger.warn(`Permissions revoked for plugin: ${pluginName}`);
  }
  
  // Private methods
  
  private checkPermission(
    pluginName: string,
    check: (perms: PluginPermissions) => boolean
  ): PermissionCheckResult {
    const permissions = this.permissionRegistry.get(pluginName);
    
    if (!permissions) {
      return {
        allowed: false,
        reason: 'Plugin permissions not registered',
      };
    }
    
    const allowed = check(permissions);
    
    return {
      allowed,
      reason: allowed ? undefined : 'No matching capability found',
    };
  }
  
  private checkServiceAccess(capabilities: PluginCapability[], serviceName: string): boolean {
    // Check if plugin has capability to access this service
    return capabilities.some(cap => {
      const protocolId = cap.protocol.id;
      
      // Check for wildcard service access
      if (protocolId.includes('protocol.service.all')) {
        return true;
      }
      
      // Check for specific service protocol
      if (protocolId.includes(`protocol.service.${serviceName}`)) {
        return true;
      }
      
      // Check for service category match
      const serviceCategory = serviceName.split('.')[0];
      if (protocolId.includes(`protocol.service.${serviceCategory}`)) {
        return true;
      }
      
      return false;
    });
  }
  
  private checkHookAccess(capabilities: PluginCapability[], hookName: string): boolean {
    // Check if plugin has capability to trigger this hook
    return capabilities.some(cap => {
      const protocolId = cap.protocol.id;
      
      // Check for wildcard hook access
      if (protocolId.includes('protocol.hook.all')) {
        return true;
      }
      
      // Check for specific hook protocol
      if (protocolId.includes(`protocol.hook.${hookName}`)) {
        return true;
      }
      
      // Check for hook category match
      const hookCategory = hookName.split(':')[0];
      if (protocolId.includes(`protocol.hook.${hookCategory}`)) {
        return true;
      }
      
      return false;
    });
  }
  
  private matchGlob(pattern: string, str: string): boolean {
    const regexStr = pattern
      .split('**')
      .map(segment => {
        const escaped = segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
        return escaped.replace(/\*/g, '[^/]*');
      })
      .join('.*');
    return new RegExp(`^${regexStr}$`).test(str);
  }
  
  private checkFileRead(capabilities: PluginCapability[], path: string): boolean {
    // Check if plugin has capability to read this file
    return capabilities.some(cap => {
      const protocolId = cap.protocol.id;
      
      // Check for file read capability
      if (protocolId.includes('protocol.filesystem.read')) {
        const paths = cap.metadata?.paths;
        if (!Array.isArray(paths) || paths.length === 0) {
          return true;
        }
        return paths.some(p => typeof p === 'string' && this.matchGlob(p, path));
      }
      
      return false;
    });
  }
  
  private checkFileWrite(capabilities: PluginCapability[], path: string): boolean {
    // Check if plugin has capability to write this file
    return capabilities.some(cap => {
      const protocolId = cap.protocol.id;
      
      // Check for file write capability
      if (protocolId.includes('protocol.filesystem.write')) {
        const paths = cap.metadata?.paths;
        if (!Array.isArray(paths) || paths.length === 0) {
          return true;
        }
        return paths.some(p => typeof p === 'string' && this.matchGlob(p, path));
      }
      
      return false;
    });
  }
  
  private checkNetworkAccess(capabilities: PluginCapability[], url: string): boolean {
    // Check if plugin has capability to access this URL
    return capabilities.some(cap => {
      const protocolId = cap.protocol.id;
      
      // Check for network capability
      if (protocolId.includes('protocol.network')) {
        const hosts = cap.metadata?.hosts;
        if (!Array.isArray(hosts) || hosts.length === 0) {
          return true;
        }
        return hosts.some(h => typeof h === 'string' && this.matchGlob(h, url));
      }
      
      return false;
    });
  }
}

/**
 * Secure Plugin Context
 * Wraps PluginContext with permission checks
 */
export class SecurePluginContext implements PluginContext {
  constructor(
    private pluginName: string,
    private permissionEnforcer: PluginPermissionEnforcer,
    private baseContext: PluginContext
  ) {}
  
  registerService(name: string, service: any): void {
    // No permission check for service registration (handled during init)
    this.baseContext.registerService(name, service);
  }
  
  getService<T>(name: string): T {
    // Check permission before accessing service
    this.permissionEnforcer.enforceServiceAccess(this.pluginName, name);
    return this.baseContext.getService<T>(name);
  }
  
  replaceService<T>(name: string, implementation: T): void {
    // Check permission before replacing service
    this.permissionEnforcer.enforceServiceAccess(this.pluginName, name);
    this.baseContext.replaceService(name, implementation);
  }
  
  getServices(): Map<string, any> {
    // Return all services (no permission check for listing)
    return this.baseContext.getServices();
  }
  
  hook(name: string, handler: (...args: any[]) => void | Promise<void>): void {
    // No permission check for registering hooks (handled during init)
    this.baseContext.hook(name, handler);
  }
  
  async trigger(name: string, ...args: any[]): Promise<void> {
    // Check permission before triggering hook
    this.permissionEnforcer.enforceHookTrigger(this.pluginName, name);
    await this.baseContext.trigger(name, ...args);
  }
  
  get logger() {
    return this.baseContext.logger;
  }
  
  getKernel() {
    return this.baseContext.getKernel();
  }

  registerServiceFactory(name: string, factory: (ctx: PluginContext, scopeId?: string) => any, lifecycle?: import('../plugin-loader.js').ServiceLifecycle, dependencies?: string[]): void {
    this.baseContext.registerServiceFactory(name, factory, lifecycle, dependencies);
  }

  getServiceScoped<T>(name: string, scopeId: string): Promise<T> {
    return this.baseContext.getServiceScoped<T>(name, scopeId);
  }
}

/**
 * Create a plugin permission enforcer
 *
 * @param logger - Logger instance
 * @returns Plugin permission enforcer
 */
export function createPluginPermissionEnforcer(logger: Logger): PluginPermissionEnforcer {
  return new PluginPermissionEnforcer(logger);
}

/**
 * Glob match supporting `*` (within a path segment) and `**` (across
 * segments). A bare `*` entry matches everything.
 */
function grantGlobMatch(pattern: string, value: string): boolean {
  if (pattern === '*' || pattern === '**') return true;
  const regexStr = pattern
    .split('**')
    .map((segment) => segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
    .join('.*');
  return new RegExp(`^${regexStr}$`).test(value);
}

/** Extract the host from a URL for network-grant matching; falls back to the raw value. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const inList = (list: string[] | undefined, value: string): boolean =>
  Array.isArray(list) && list.some((p) => p === value || grantGlobMatch(p, value));

/**
 * Build the runtime {@link PluginPermissions} bag from a structured
 * install-time grant set (ADR-0025 §3.2 `{ services, hooks, network, fs }`).
 *
 * Matching: an entry allows when it equals the requested value, is a glob
 * that matches it, or is the wildcard `*`. Network grants match against the
 * request URL's host (or the raw URL). `fs` governs both read and write —
 * the structured grant set does not split the two. A null/empty grant set
 * denies everything (principle of least privilege).
 */
export function buildPermissionsFromGrants(
  granted: GrantedPermissions | null | undefined,
): PluginPermissions {
  const services = granted?.services;
  const hooks = granted?.hooks;
  const network = granted?.network;
  const fs = granted?.fs;
  return {
    canAccessService: (name) => inList(services, name),
    canTriggerHook: (name) => inList(hooks, name),
    canReadFile: (path) => inList(fs, path),
    canWriteFile: (path) => inList(fs, path),
    canNetworkRequest: (url) =>
      inList(network, hostOf(url)) || inList(network, url),
  };
}
