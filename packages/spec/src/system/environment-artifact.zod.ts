// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * # Environment Artifact Format Protocol (v0)
 *
 * Defines the immutable envelope produced by `objectstack compile` and consumed
 * by the ObjectStack runtime at boot. The artifact carries everything a runtime instance
 * needs to hydrate an environment kernel without reading control-plane DB rows
 * directly.
 *
 * ## Boundary
 *
 * - **Artifact (this schema):** environment metadata + inlined function code +
 *   plugin/driver requirements. Immutable, content-addressable via `commitId`
 *   and `checksum`.
 * - **Deployment Config (NOT in this schema):** business DB coordinates,
 *   credentials, environment identity, secrets. Injected at runtime.
 *
 * See {@link content/docs/concepts/north-star.mdx} §6.3 for the runtime-inputs
 * boundary, and {@link ROADMAP.md} M1 for the milestone definition.
 *
 * ## Storage / Distribution
 *
 * v0 stores the full payload inline. Future revisions may swap `metadata` /
 * `functions` for a `payloadRef` that points at out-of-band storage (S3,
 * signed URL). The envelope shape preserves room for that indirection without
 * a breaking schema bump.
 */

// ==========================================
// Constants
// ==========================================

/** Current artifact schema version. Bump on every breaking envelope change. */
export const ENVIRONMENT_ARTIFACT_SCHEMA_VERSION = '0.1' as const;

/** Hash algorithms permitted for artifact checksums. */
export const EnvironmentArtifactHashAlgorithmEnum = z
  .enum(['sha256', 'sha384', 'sha512'])
  .describe('Hash algorithm used for the artifact checksum');

export type EnvironmentArtifactHashAlgorithm = z.infer<typeof EnvironmentArtifactHashAlgorithmEnum>;

// ==========================================
// Checksum
// ==========================================

/**
 * Content-addressable checksum of the canonical JSON-serialized artifact body
 * (everything except the `checksum` field itself). Used by the runtime to verify
 * that the artifact bytes were not tampered with in transit and to key the
 * local artifact cache.
 */
export const EnvironmentArtifactChecksumSchema = z
  .object({
    algorithm: EnvironmentArtifactHashAlgorithmEnum.default('sha256'),
    value: z
      .string()
      .regex(/^[a-f0-9]+$/, 'Checksum value must be lowercase hexadecimal')
      .describe('Hex-encoded digest of the artifact body'),
  })
  .describe('Artifact integrity checksum');

export type EnvironmentArtifactChecksum = z.infer<typeof EnvironmentArtifactChecksumSchema>;

// ==========================================
// Function code packaging
// ==========================================

/**
 * Languages supported for inlined function code. The runtime decides how to
 * load each language; v0 only commits to JavaScript bytes shipping unmodified.
 */
export const EnvironmentArtifactFunctionLanguageEnum = z
  .enum(['javascript', 'typescript'])
  .describe('Source language of the function code');

export type EnvironmentArtifactFunctionLanguage = z.infer<typeof EnvironmentArtifactFunctionLanguageEnum>;

/**
 * A single function (object trigger, computed field, action, etc.) packaged
 * into the artifact. Function code is inlined as a UTF-8 string; binary or
 * out-of-band storage is reserved for a future revision via `payloadRef`.
 */
export const EnvironmentArtifactFunctionSchema = z
  .object({
    /** Globally unique function name (snake_case). */
    name: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/)
      .describe('Function machine name (snake_case)'),

    /** Source language of the inlined `code` field. */
    language: EnvironmentArtifactFunctionLanguageEnum.default('javascript'),

    /** UTF-8 encoded function source. Must be self-contained. */
    code: z.string().describe('Inlined function source'),

    /**
     * Optional provenance pointer: where the code came from in the original
     * TypeScript workspace. Useful for debug overlays in Studio.
     */
    source: z
      .object({
        path: z.string().optional().describe('Source file path (relative to project root)'),
        exportName: z.string().optional().describe('Exported symbol name'),
      })
      .optional()
      .describe('Source-map metadata for the function'),

    /** Hex SHA-256 of `code` for cache invalidation. */
    hash: z
      .string()
      .regex(/^[a-f0-9]+$/)
      .optional()
      .describe('Hex SHA-256 of the inlined code'),
  })
  .describe('A single inlined function');

export type EnvironmentArtifactFunction = z.infer<typeof EnvironmentArtifactFunctionSchema>;

// ==========================================
// Plugin / Driver requirements
// ==========================================

/**
 * Plugin/driver requirement entry. The runtime uses these to verify that the
 * runtime has every plugin the environment depends on before hydrating the kernel.
 * Configuration values live in **Deployment Config**, not in the artifact.
 */
export const EnvironmentArtifactRequirementSchema = z
  .object({
    /** Package id (reverse-domain or short id). */
    id: z.string().describe('Plugin/driver package id'),

    /** SemVer range required by the environment. */
    version: z.string().optional().describe('SemVer range required by the environment'),
  })
  .describe('A plugin or driver dependency declaration');

export type EnvironmentArtifactRequirement = z.infer<typeof EnvironmentArtifactRequirementSchema>;

/**
 * Environment-level manifest captured inside the artifact. Mirrors the parts of
 * the package manifest the runtime needs to bootstrap; user-facing manifest
 * fields (description, icon, marketplace metadata) are excluded.
 */
export const EnvironmentArtifactManifestSchema = z
  .object({
    /** Plugins required to run this environment's metadata. */
    plugins: z.array(EnvironmentArtifactRequirementSchema).optional(),

    /** Drivers required to run this environment's metadata. */
    drivers: z.array(EnvironmentArtifactRequirementSchema).optional(),

    /** Minimum platform version (mirrors `Manifest.engine`). */
    engine: z
      .object({
        objectstack: z
          .string()
          .regex(/^[><=~^]*\d+\.\d+\.\d+/)
          .describe('ObjectStack platform version requirement (SemVer range)'),
      })
      .optional(),
  })
  .describe('Plugin/driver requirements baked into the artifact');

export type EnvironmentArtifactManifest = z.infer<typeof EnvironmentArtifactManifestSchema>;

// ==========================================
// Metadata payload
// ==========================================

/**
 * Compiled project metadata. v0 is intentionally permissive: the inner shape
 * is validated by the protocol-level `ObjectStackDefinitionSchema` (and per-
 * domain Zod schemas) rather than re-validated here, to avoid coupling the
 * artifact envelope to every domain schema bump.
 *
 * Treat this as a typed bag of arrays keyed by metadata category. Unknown
 * categories are passed through (`passthrough()`) so older runtime builds can
 * boot newer artifacts safely if no breaking changes were made.
 */
export const EnvironmentArtifactMetadataSchema = z
  .object({
    objects: z.array(z.unknown()).optional(),
    fields: z.array(z.unknown()).optional(),
    views: z.array(z.unknown()).optional(),
    apps: z.array(z.unknown()).optional(),
    pages: z.array(z.unknown()).optional(),
    dashboards: z.array(z.unknown()).optional(),
    reports: z.array(z.unknown()).optional(),
    flows: z.array(z.unknown()).optional(),
    workflows: z.array(z.unknown()).optional(),
    triggers: z.array(z.unknown()).optional(),
    agents: z.array(z.unknown()).optional(),
    tools: z.array(z.unknown()).optional(),
    skills: z.array(z.unknown()).optional(),
    permissions: z.array(z.unknown()).optional(),
    permissionSets: z.array(z.unknown()).optional(),
    // ADR-0090 D3/D2: `roles`/`profiles` categories retired with the concepts
    // (stacks declare `positions`; the profile concept is gone). Old artifacts
    // carrying them still parse via `passthrough()` — the keys are simply no
    // longer part of the declared envelope.
    positions: z.array(z.unknown()).optional(),
    translations: z.array(z.unknown()).optional(),
    datasources: z.array(z.unknown()).optional(),
    datasets: z.array(z.unknown()).optional(),
    actions: z.array(z.unknown()).optional(),
    apis: z.array(z.unknown()).optional(),
  })
  .passthrough()
  .describe('Compiled environment metadata grouped by category');

export type EnvironmentArtifactMetadata = z.infer<typeof EnvironmentArtifactMetadataSchema>;

// ==========================================
// Out-of-band payload reference (reserved)
// ==========================================

/**
 * Reserved indirection for moving large payloads out of the inline JSON. v0
 * artifacts inline `metadata` and `functions` directly; future revisions can
 * set `payloadRef` to a signed URL and omit (or truncate) the inline copies.
 *
 * Defined now so the envelope shape is stable across the inline-only ↔ S3
 * transition.
 */
export const EnvironmentArtifactPayloadRefSchema = z
  .object({
    url: z.string().url().describe('Signed URL pointing at the artifact payload'),
    expiresAt: z.string().datetime().optional().describe('ISO-8601 expiry timestamp'),
    checksum: EnvironmentArtifactChecksumSchema.describe('Checksum of the referenced payload'),
  })
  .describe('Out-of-band payload reference (reserved for future use)');

export type EnvironmentArtifactPayloadRef = z.infer<typeof EnvironmentArtifactPayloadRefSchema>;

// ==========================================
// Envelope
// ==========================================

/**
 * Environment Artifact envelope.
 *
 * Produced by `objectstack compile`, served by the Environment Artifact API
 * (`GET /api/v1/cloud/environments/:environmentId/artifact`), and consumed by the
 * runtime metadata loader to hydrate an environment kernel.
 *
 * Required fields (v0):
 * - `schemaVersion`: tracks the envelope itself.
 * - `environmentId`: which environment this artifact belongs to.
 * - `commitId`: monotonic, content-addressable identifier; cache key.
 * - `checksum`: integrity check over the artifact body.
 * - `metadata`: compiled metadata grouped by category.
 * - `functions`: inlined function code.
 * - `manifest`: plugin/driver requirements.
 *
 * Optional fields (v0):
 * - `builtAt`, `builtWith`: provenance.
 * - `payloadRef`: reserved for future S3 indirection.
 */
export const EnvironmentArtifactSchema = z
  .object({
    /** Envelope schema version. Currently always `'0.1'`. */
    schemaVersion: z
      .literal(ENVIRONMENT_ARTIFACT_SCHEMA_VERSION)
      .describe('Environment artifact envelope schema version'),

    /** Stable environment identifier from the control plane. */
    environmentId: z.string().min(1).describe('Environment identifier (control-plane scoped)'),

    /**
     * Monotonic, content-addressable revision id assigned by the control plane
     * when the artifact is published. Used as a cache key by the runtime and as
     * the rollback target by Studio.
     */
    commitId: z.string().min(1).describe('Content-addressable revision id'),

    /** Integrity checksum over the canonical artifact body. */
    checksum: EnvironmentArtifactChecksumSchema,

    /** ISO-8601 build timestamp. */
    builtAt: z
      .string()
      .datetime()
      .optional()
      .describe('ISO-8601 timestamp of when the artifact was built'),

    /** Build tool identifier (e.g. `"objectstack-cli@3.4.0"`). */
    builtWith: z.string().optional().describe('Build tool identifier'),

    /** Compiled environment metadata grouped by category. */
    metadata: EnvironmentArtifactMetadataSchema,

    /** Inlined function code. Empty array if the environment has no functions. */
    functions: z
      .array(EnvironmentArtifactFunctionSchema)
      .default([])
      .describe('Inlined function code packaged with the artifact'),

    /** Plugin/driver requirements baked at compile time. */
    manifest: EnvironmentArtifactManifestSchema,

    /** Out-of-band payload reference (reserved). */
    payloadRef: EnvironmentArtifactPayloadRefSchema.optional(),
  })
  .describe('ObjectStack Environment Artifact envelope (v0)');

export type EnvironmentArtifact = z.infer<typeof EnvironmentArtifactSchema>;
export type EnvironmentArtifactInput = z.input<typeof EnvironmentArtifactSchema>;
