// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Package Artifact Format Protocol
 *
 * Defines the standard structure of a package artifact (.tgz) produced by
 * the build pipeline. The marketplace uses these schemas to validate, store,
 * and distribute package artifacts.
 *
 * ## Artifact Internal Structure
 * ```
 * ├── manifest.json          ← ManifestSchema serialized
 * ├── metadata/              ← 30+ metadata types (JSON)
 * │   ├── objects/            ← *.object.json
 * │   ├── views/              ← *.view.json
 * │   ├── pages/              ← *.page.json
 * │   ├── flows/              ← *.flow.json
 * │   ├── dashboards/         ← *.dashboard.json
 * │   ├── permissions/        ← *.permission.json
 * │   ├── agents/             ← *.agent.json
 * │   └── ...                 ← Other metadata types
 * ├── assets/                ← Static resources
 * │   ├── icon.svg
 * │   └── screenshots/
 * ├── data/                  ← Seed data (SeedSchema serialized)
 * ├── locales/               ← i18n translation files
 * ├── checksums.json         ← SHA256 checksum per file
 * └── signature.sig          ← RSA-SHA256 package signature
 * ```
 *
 * ## Architecture Alignment
 * - **Salesforce**: Managed Package .zip with metadata components
 * - **npm**: .tgz with package.json + contents
 * - **Helm**: Chart .tgz with Chart.yaml + templates
 * - **VS Code**: .vsix (zip) with extension manifest + assets
 */

// ==========================================
// Metadata Category Definitions
// ==========================================

/**
 * Supported metadata categories within an artifact.
 * Each category maps to a subdirectory under `metadata/`.
 */
import { lazySchema } from '../shared/lazy-schema';
export const MetadataCategoryEnum = z.enum([
  'objects',
  'views',
  'pages',
  'flows',
  'dashboards',
  'permissions',
  'agents',
  'reports',
  'actions',
  'translations',
  'themes',
  'datasets',
  'apis',
  'triggers',
  'workflows',
]).describe('Metadata category within the artifact');

export type MetadataCategory = z.input<typeof MetadataCategoryEnum>;

// ==========================================
// Artifact File Entry
// ==========================================

/**
 * A single file entry within the artifact.
 */
export const ArtifactFileEntrySchema = lazySchema(() => z.object({
  /** Relative path within the artifact (e.g. "metadata/objects/account.object.json") */
  path: z.string().describe('Relative file path within the artifact'),

  /** File size in bytes */
  size: z.number().int().nonnegative().describe('File size in bytes'),

  /** Metadata category (if under metadata/) */
  category: MetadataCategoryEnum.optional()
    .describe('Metadata category this file belongs to'),
}).describe('A single file entry within the artifact'));

export type ArtifactFileEntry = z.input<typeof ArtifactFileEntrySchema>;

// ==========================================
// Artifact Checksum
// ==========================================

/**
 * Checksum map for artifact integrity verification.
 * Maps relative file paths to their SHA256 hash values.
 *
 * @example
 * {
 *   "manifest.json": "a1b2c3...",
 *   "metadata/objects/account.object.json": "d4e5f6..."
 * }
 */
export const ArtifactChecksumSchema = lazySchema(() => z.object({
  /** Hash algorithm used (default: SHA256) */
  algorithm: z.enum(['sha256', 'sha384', 'sha512']).default('sha256')
    .describe('Hash algorithm used for checksums'),

  /** Map of relative file paths to their hash values */
  files: z.record(z.string(), z.string().regex(/^[a-f0-9]+$/))
    .describe('File path to hash value mapping'),
}).describe('Checksum manifest for artifact integrity verification'));

export type ArtifactChecksum = z.input<typeof ArtifactChecksumSchema>;
/** Post-parse shape of {@link ArtifactChecksum} — defaults applied, transforms run (ADR-0122). */
export type ArtifactChecksumParsed = z.infer<typeof ArtifactChecksumSchema>;

// ==========================================
// Artifact Signature
// ==========================================

/**
 * Digital signature for artifact authenticity verification.
 * Ensures the artifact was produced by a trusted publisher and has not been tampered with.
 */
export const ArtifactSignatureSchema = lazySchema(() => z.object({
  /** Signature algorithm */
  algorithm: z.enum(['RSA-SHA256', 'RSA-SHA384', 'RSA-SHA512', 'ECDSA-SHA256']).default('RSA-SHA256')
    .describe('Signing algorithm used'),

  /** Public key reference (URL or fingerprint) for verification */
  publicKeyRef: z.string()
    .describe('Public key reference (URL or fingerprint) for signature verification'),

  /** Base64-encoded signature value */
  signature: z.string()
    .describe('Base64-encoded digital signature'),

  /** Timestamp of when the artifact was signed */
  signedAt: z.string().datetime().optional()
    .describe('ISO 8601 timestamp of when the artifact was signed'),

  /** Signer identity (publisher ID or email) */
  signedBy: z.string().optional()
    .describe('Identity of the signer (publisher ID or email)'),
}).describe('Digital signature for artifact authenticity verification'));

export type ArtifactSignature = z.input<typeof ArtifactSignatureSchema>;
/** Post-parse shape of {@link ArtifactSignature} — defaults applied, transforms run (ADR-0122). */
export type ArtifactSignatureParsed = z.infer<typeof ArtifactSignatureSchema>;

// ==========================================
// Package Artifact Schema
// ==========================================

/**
 * Package Artifact Schema
 *
 * Describes the complete structure and metadata of a built package artifact.
 * This schema is used to validate artifacts before upload to the marketplace.
 */
export const PackageArtifactSchema = lazySchema(() => z.object({
  /** Artifact format version (for forward compatibility) */
  formatVersion: z.string().regex(/^\d+\.\d+$/).default('1.0')
    .describe('Artifact format version (e.g. "1.0")'),

  /** Package ID from the manifest */
  packageId: z.string().describe('Package identifier from manifest'),

  /** Package version from the manifest */
  version: z.string().describe('Package version from manifest'),

  /** Artifact format */
  format: z.enum(['tgz', 'zip']).default('tgz')
    .describe('Archive format of the artifact'),

  /** Total artifact size in bytes */
  size: z.number().int().positive().optional()
    .describe('Total artifact file size in bytes'),

  /** Build timestamp */
  builtAt: z.string().datetime()
    .describe('ISO 8601 timestamp of when the artifact was built'),

  /** Build tool and version that produced this artifact */
  builtWith: z.string().optional()
    .describe('Build tool identifier (e.g. "os-cli@3.2.0")'),

  /** File listing within the artifact */
  files: z.array(ArtifactFileEntrySchema).optional()
    .describe('List of files contained in the artifact'),

  /** Metadata categories present in the artifact */
  metadataCategories: z.array(MetadataCategoryEnum).optional()
    .describe('Metadata categories included in this artifact'),

  /** Integrity checksums for all files */
  checksums: ArtifactChecksumSchema.optional()
    .describe('SHA256 checksums for artifact integrity verification'),

  /** Digital signature for authenticity */
  signature: ArtifactSignatureSchema.optional()
    .describe('Digital signature for artifact authenticity verification'),
}).describe('Package artifact structure and metadata'));

export type PackageArtifact = z.input<typeof PackageArtifactSchema>;
/** Post-parse shape of {@link PackageArtifact} — defaults applied, transforms run (ADR-0122). */
export type PackageArtifactParsed = z.infer<typeof PackageArtifactSchema>;
