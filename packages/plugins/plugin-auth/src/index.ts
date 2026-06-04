// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/plugin-auth
 * 
 * Authentication & Identity Plugin for ObjectStack
 * Powered by better-auth for robust, secure authentication
 * Uses ObjectQL for data persistence (no third-party ORM required)
 */

export * from './auth-plugin.js';
export * from './auth-manager.js';
export * from './set-initial-password.js';
export * from './objectql-adapter.js';
export * from './auth-schema-config.js';
export type { AuthConfig, AuthProviderConfig, AuthPluginConfig } from '@objectstack/spec/system';
