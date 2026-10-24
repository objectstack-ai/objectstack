/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/core - Sharing Protocol Bridge
 *
 * Converts spec-aligned SharingConfig and EmbedConfig schemas into
 * runtime-usable configurations. Provides embed code generation and
 * configuration validation.
 *
 * @module protocols/SharingProtocol
 * @packageDocumentation
 */

import type { SharingConfig } from '@object-ui/types';

// ============================================================================
// Embed Vocabulary (formerly `@objectstack/spec/ui`)
// ============================================================================
// `EmbedConfig` / `EmbedConfigSchema` were RETIRED in `@objectstack/spec`
// 17.0.0-rc.3 (objectstack#5015, PR objectstack#5300): they were published
// `ui` vocabulary with NO AUTHORING DOOR, and no iframe route ever read an
// embed config, so nothing ran to regress. `SharingConfig` is the SURVIVOR and
// is still the spec's — public form sharing is unaffected and `FormView.sharing`
// still gates the anonymous endpoints on `allowAnonymous` + `publicLink`.
//
// The declaration below is the retired shape moved here verbatim, so that
// `resolveEmbedConfig` / `generateEmbedCode` keep the exact input contract they
// had. Whether this bridge should exist at all now that the platform has
// withdrawn the vocabulary is a product question for objectui#3362, not a
// green-restoring one — this change deliberately keeps the surface intact.

/** An iframe embed declaration. */
export interface EmbedConfig {
  enabled: boolean;
  allowedOrigins?: string[];
  width?: string;
  height?: string;
  showHeader?: boolean;
  showNavigation?: boolean;
  responsive?: boolean;
}

// ============================================================================
// Resolved Types
// ============================================================================

/** Fully resolved sharing configuration. */
export interface ResolvedSharingConfig {
  enabled: boolean;
  publicLink?: string;
  password?: string;
  allowedDomains: string[];
  expiresAt?: string;
  allowAnonymous: boolean;
}

/** Fully resolved embed configuration. */
export interface ResolvedEmbedConfig {
  enabled: boolean;
  allowedOrigins: string[];
  width: string;
  height: string;
  showHeader: boolean;
  showNavigation: boolean;
  responsive: boolean;
}

/** Validation result for sharing configuration. */
export interface SharingValidationResult {
  valid: boolean;
  errors: string[];
}

// ============================================================================
// Sharing Config Resolution
// ============================================================================

/**
 * Resolve a sharing configuration by applying spec defaults.
 *
 * @param config - Partial SharingConfig from the spec
 * @returns Fully resolved sharing configuration
 */
export function resolveSharingConfig(config: Partial<SharingConfig>): ResolvedSharingConfig {
  return {
    enabled: config.enabled ?? false,
    publicLink: config.publicLink,
    password: config.password,
    allowedDomains: config.allowedDomains ?? [],
    expiresAt: config.expiresAt,
    allowAnonymous: config.allowAnonymous ?? false,
  };
}

// ============================================================================
// Embed Config Resolution
// ============================================================================

/**
 * Resolve an embed configuration by applying spec defaults.
 *
 * @param config - Partial EmbedConfig from the spec
 * @returns Fully resolved embed configuration
 */
export function resolveEmbedConfig(config: Partial<EmbedConfig>): ResolvedEmbedConfig {
  return {
    enabled: config.enabled ?? false,
    allowedOrigins: config.allowedOrigins ?? [],
    width: config.width ?? '100%',
    height: config.height ?? '600px',
    showHeader: config.showHeader ?? true,
    showNavigation: config.showNavigation ?? false,
    responsive: config.responsive ?? true,
  };
}

// ============================================================================
// Embed Code Generation
// ============================================================================

/**
 * Generate an HTML iframe embed snippet from an EmbedConfig and URL.
 *
 * @param config - EmbedConfig from the spec
 * @param url - The URL to embed
 * @returns HTML string containing an iframe element
 */
export function generateEmbedCode(config: EmbedConfig, url: string): string {
  const resolved = resolveEmbedConfig(config);
  const sanitizedUrl = escapeHtmlAttr(url);
  const title = 'Embedded content';

  const parts = [
    `<iframe`,
    `  src="${sanitizedUrl}"`,
    `  width="${escapeHtmlAttr(resolved.width)}"`,
    `  height="${escapeHtmlAttr(resolved.height)}"`,
    `  title="${title}"`,
    `  frameborder="0"`,
    `  allowfullscreen`,
  ];

  if (resolved.responsive) {
    parts.push(`  style="max-width: 100%; border: none;"`);
  } else {
    parts.push(`  style="border: none;"`);
  }

  parts.push(`></iframe>`);

  return parts.join('\n');
}

/**
 * Escape a string for safe use in an HTML attribute value.
 */
function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ============================================================================
// Sharing Config Validation
// ============================================================================

/**
 * Validate a sharing configuration and return any errors.
 *
 * @param config - SharingConfig to validate
 * @returns Validation result with `valid` flag and error messages
 */
export function validateSharingConfig(config: SharingConfig): SharingValidationResult {
  const errors: string[] = [];

  if (config.enabled && !config.publicLink) {
    errors.push('A public link is required when sharing is enabled.');
  }

  if (config.expiresAt) {
    const expiryDate = new Date(config.expiresAt);
    if (isNaN(expiryDate.getTime())) {
      errors.push('expiresAt must be a valid ISO 8601 date string.');
    }
  }

  if (config.allowedDomains) {
    for (const domain of config.allowedDomains) {
      if (!domain || domain.trim().length === 0) {
        errors.push('allowedDomains contains an empty or whitespace-only entry.');
        break;
      }
    }
  }

  if (config.password !== undefined && config.password.length === 0) {
    errors.push('Password must not be an empty string when provided.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
